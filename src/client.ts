import { Log } from "mx-puppet-bridge";
import { IgApiClient, DirectInboxFeed, IgLoginRequiredError } from "instagram-private-api";
import { EventEmitter } from "events";
import * as Jimp from "jimp";
import { Cookie } from "tough-cookie";

const log = new Log("InstagramPuppet:client");

export class Client extends EventEmitter {
	// tslint:disable:no-magic-numbers
	private backoffIntervals = [
		500, 500, 500, 500, 500, 500, 500, 500, 500, 500, // 5 seconds
		1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, // 8 seconds
		2000, 2000, 2000, 2000, 2000, 2000, // 12 seconds
		3000, 3000, 3000, 3000, 3000, // 15 seconds
		4000, 4000, 4000, 4000, 4000, // 20 seconds
		5000, 5000, 5000, 5000, 5000, // 25 seconds
		7500, 7500, 7500, 7500, 7500,
		10000,
	];
	// tslint:enable:no-magic-numbers
	private currBackoff: number = 0;
	private ig: IgApiClient;
	private inboxFeed: DirectInboxFeed;
	private timeout: NodeJS.Timeout | null;
	private disconnecting: boolean;
	private lastThreadMessages: { [threadId: string]: number };
	private users: { [userId: string]: any };
	private sentEvents: string[];
	constructor(
		private sessionid: string,
		private username?: string,
		private password?: string,
	) {
		super();
		this.currBackoff = 0;
		this.ig = new IgApiClient();
		this.timeout = null;
		this.disconnecting = false;
		this.lastThreadMessages = {};
		this.users = {};
		this.sentEvents = [];
	}

	public async connect() {
		if (this.sessionid) {
			const cookies = {
				storeType: "MemoryCookieStore",
				rejectPublicSuffixes: true,
				cookies: [
					new Cookie({
						key: "sessionid",
						value: this.sessionid,
						domain: "instagram.com",
						path: "/",
						secure: true,
						httpOnly: true,
						hostOnly: false,
						maxAge: 31536000,
						creation: new Date(),
					}),
				],
			};
			await this.ig.state.deserializeCookieJar(JSON.stringify(cookies));
		} else if (this.username && this.password) {
			this.ig.state.generateDevice(this.username);
			await this.ig.simulate.preLoginFlow();
			await this.ig.account.login(this.username, this.password);
		} else {
			throw new Error("no login method provided");
		}
		const auth = await this.ig.account.currentUser();
		log.verbose(auth);
		const authUser = {
			userId: auth.pk.toString(),
			name: auth.full_name,
			avatar: auth.profile_pic_url,
			avatarId: auth.profile_pic_id,
		};
		this.users[authUser.userId] = authUser;
		this.emit("auth", authUser, auth);
		this.inboxFeed = this.ig.feed.directInbox();
		// do in background
		// tslint:disable-next-line:no-floating-promises
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

	public async sendPhoto(threadId: string, file: Buffer): Promise<string | null> {
		const image = await Jimp.read(file);
		const WHITE = 0xFFFFFFFF;
		image.rgba(false).background(WHITE);
		const jpg = await image.getBufferAsync(Jimp.MIME_JPEG);
		const thread = this.ig.entity.directThread(threadId);
		const ret = await thread.broadcastPhoto({
			file: jpg,
		});
		if (!ret) {
			return null;
		}
		this.sentEvents.push(ret.item_id);
		return ret.item_id;
	}

	public async sendLink(threadId: string, name: string, url: string): Promise<string | null> {
		const thread = this.ig.entity.directThread(threadId);
		const ret = await thread.broadcastLink(name, [url]);
		if (!ret) {
			return null;
		}
		this.sentEvents.push(ret.item_id);
		return ret.item_id;
	}

	private igTsToNormal(ts: string): number {
		// instagram TS's are in microseconds
		const MICRO_TO_MILLI = 3;
		return parseInt(ts.substring(0, ts.length - MICRO_TO_MILLI), 10);
	}

	private async singleUpdate() {
		let processedMessage = false;
		try {
			const threads = await this.inboxFeed.items();
			for (const thread of threads) {
				// first we update users accordingly
				for (const user of thread.users) {
					const newUser = {
						userId: user.pk.toString(),
						name: user.full_name,
						avatar: user.profile_pic_url,
						avatarId: user.profile_pic_id,
					};
					const oldUser = this.users[newUser.userId];
					if (oldUser) {
						// okay, the problem is that instagram changes the avatar url
						// on every single message sent, so we have nothing
						// to keep track of the actual avatar without uploading tons of duplicates
						// so instead, we need to check for a change in the avatarId
						if (newUser.name !== oldUser.name || newUser.avatarId !== oldUser.avatarId) {
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
						processedMessage = true;
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
							case "reel_share":
								event.text = item.reel_share.text;
								this.emit("reel_share", event, item.reel_share);
								break;
							case "media_share":
								this.emit("media_share", event, item.media_share);
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
		} catch (err) {
			if (err instanceof IgLoginRequiredError) {
				// we aren't logged in anymore, somehow. Please stand by while we panic
				this.emit("logout");
				await this.disconnect();
				return;
			}
			log.error("Error updating from instagram:", err);
		}

		if (!this.disconnecting) {
			// backoff logic
			if (!processedMessage) {
				if (this.currBackoff < this.backoffIntervals.length - 1) {
					this.currBackoff++;
				}
			} else {
				this.currBackoff = 0;
			}
			this.timeout = setTimeout(this.singleUpdate.bind(this), this.backoffIntervals[this.currBackoff]);
		}
	}
}
