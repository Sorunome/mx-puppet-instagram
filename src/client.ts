import { Log } from "mx-puppet-bridge";
import { IgApiClient, DirectInboxFeed } from "instagram-private-api";
import { EventEmitter } from "events";

const log = new Log("InstagramPuppet:client");

export class Client extends EventEmitter {
	private ig: IgApiClient;
	private inboxFeed: DirectInboxFeed;
	private timeout: NodeJS.Timeout | null;
	private disconnecting: boolean;
	private lastThreadMessages: { [threadId: string]: Number };
	private users: { [userId: string]: any };
	private sentEvents: string[];
	constructor(
		private username: string,
		private password: string,
	) {
		super();
		this.ig = new IgApiClient();
		this.timeout = null;
		this.disconnecting = false;
		this.lastThreadMessages = {};
		this.users = {};
		this.sentEvents = [];
	}

	public async connect() {
		this.ig.state.generateDevice(this.username);
		await this.ig.simulate.preLoginFlow();
		const auth = await this.ig.account.login(this.username, this.password);
		log.silly(auth);
		this.users[auth.pk.toString()] = {
			userId: auth.pk.toString(),
			name: auth.full_name,
			avatar: auth.profile_pic_url,
		};
		this.inboxFeed = await this.ig.feed.directInbox();
		// do in background
		this.singleUpdate();
	}

	public async disconnect() {
		this.disconnecting = true;
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
		}
	}

	public getUser(id: string): any | null {
		log.verbose(id);
		log.verbose(this.users);
		if (!this.users[id]) {
			return null;
		}
		return this.users[id];
	}

	public async sendMessage(threadId: string, text: string): Promise<string | null> {
		const thread = this.ig.entity.directThread(threadId);
		const ret = await thread.broadcastText(text);
		if (!ret) {
			return null;
		}
		this.sentEvents.push(ret.item_id);
		return ret.item_id;
	}

	private igTsToNormal(ts: string): Number {
		// instagram TS's are in microseconds
		return parseInt(ts.substring(0, ts.length - 3));
	}

	private async singleUpdate() {
		const threads = await this.inboxFeed.items();
		log.silly("=======");
		for (const thread of threads) {
			// first we update users accordingly
			for (const user of thread.users) {
				const newUser = {
					userId: user.pk.toString(),
					name: user.full_name,
					avatar: user.profile_pic_url,
				};
				const oldUser = this.users[newUser.userId];
				if (oldUser) {
					if (newUser.name !== oldUser.name || newUser.avatar !== oldUser.avatar) {
						this.emit("userupdate", newUser);
						this.users[newUser.userId] = newUser;
					}
				} else {
					this.users[newUser.userId] = newUser;
				}
			}

			const threadId = thread.thread_id;
			const oldTs = this.lastThreadMessages[threadId];
			if (!oldTs) {
				this.lastThreadMessages[threadId] = thread.items[0] ? this.igTsToNormal(thread.items[0].timestamp) : 0;
				continue;
			}
			thread.items.reverse(); // we want to process the oldest one first
			for (const item of thread.items as any[]) {
				const ts = this.igTsToNormal(item.timestamp);
				if (oldTs >= ts) {
					continue;
				}
				if (this.sentEvents.includes(item.item_id)) {
					// duplicate, ignore
					// remove the entry from the array because, well it is unneeded now
					const ix = this.sentEvents.indexOf(item.item_id);
					if (ix !== -1) {
						this.sentEvents.splice(ix, 1);
					}
				} else {
					// we have a new message!!!!
					const event = {
						eventId: item.item_id,
						userId: item.user_id.toString(),
						threadId,
						isPrivate: thread.thread_type === "private",
						threadTitle: thread.thread_title,
					} as any;
					switch (item.item_type) {
						case "text":
							event.text = item.text;
							this.emit("message", event);
							break;
						case "media":
							event.url = item.media.image_versions2.candidates[0].url;
							this.emit("file", event);
							break;
						case "voice_media":
							event.url = item.voice_media.media.audio.audio_src;
							this.emit("file", event);
							break;
						case "like":
							event.text = item.like;
							this.emit("message", event);
							break;
						case "animated_media":
							event.url = item.animated_media.images.fixed_height.url;
							this.emit("file", event);
							break;
						default:
							log.silly("Unknown item type", item);
					}
				}
				this.lastThreadMessages[threadId] = ts;
			}
		}
		// TODO: back-away logic
		if (!this.disconnecting) {
			this.timeout = setTimeout(this.singleUpdate.bind(this), 5000);
		}
	}
}
