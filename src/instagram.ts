import {
	PuppetBridge,
	Log,
	IReceiveParams,
	IMessageEvent,
	IRemoteUser,
	IRemoteRoom,
	IFileEvent,
	Util,
} from "mx-puppet-bridge";
import { Client } from "./client";
import * as escapeHtml from "escape-html";
import { InstagramProvisioningAPI } from "./api";

const log = new Log("InstagramPuppet:instagram");

interface IInstagramPuppet {
	client: Client;
	data: any;
}

interface IInstagramPuppets {
	[puppetId: number]: IInstagramPuppet;
}

export class Instagram {
	private puppets: IInstagramPuppets = {};
	private provisioningAPI: InstagramProvisioningAPI;
	constructor(
		private puppet: PuppetBridge,
	) {
		this.provisioningAPI = new InstagramProvisioningAPI(puppet);
	}

	public getSendParams(puppetId: number, msg: any): IReceiveParams {
		let eventId: string | undefined;
		if (msg.eventId) {
			eventId = msg.eventId;
		}
		return {
			room: {
				roomId: msg.threadId,
				puppetId,
				isDirect: msg.isPrivate,
			},
			user: {
				userId: msg.userId,
				puppetId,
			},
			eventId,
		};
	}

	public async createUser(getUser: IRemoteUser): Promise<IRemoteUser | null> {
		const p = this.puppets[getUser.puppetId];
		if (!p) {
			return null;
		}
		log.verbose("Got create user request for", getUser);
		const user = p.client.getUser(getUser.userId);
		if (!user) {
			return null;
		}
		return {
			puppetId: getUser.puppetId,
			userId: user.userId,
			name: user.name,
			avatarUrl: user.avatar,
		};
	}

	public async newPuppet(puppetId: number, data: any) {
		log.info(`Adding new Puppet: puppetId=${puppetId}`);
		if (this.puppets[puppetId]) {
			await this.deletePuppet(puppetId);
		}
		const client = new Client(data.sessionid, data.username, data.password);
		this.puppets[puppetId] = {
			client,
			data,
		} as IInstagramPuppet;
		client.on("auth", async (user: any, auth: any) => {
			const d = this.puppets[puppetId].data;
			d.username = auth.username;
			d.name = user.name;
			d.userId = user.userId;
			await this.puppet.setUserId(puppetId, user.userId);
			await this.puppet.setPuppetData(puppetId, d);
			await this.puppet.sendStatusMessage(puppetId, "connected!");
		});
		client.on("message", async (msg: any) => {
			log.verbose("Got message to pass on", msg);
			const params = this.getSendParams(puppetId, msg);
			await this.puppet.sendMessage(params, {
				body: msg.text,
			});
		});
		client.on("reel_share", async (msg: any, share: any) => {
			log.verbose("Got share to pass on", msg);
			const imgUrl = share.media.image_versions2.candidates[0].url;

			const pronoun = share.media.user.pk === this.puppets[puppetId].data.userId ? "your" : "their";

			const params = this.getSendParams(puppetId, msg);
			await this.puppet.sendMessage(params, {
				body: `New reply to ${pronoun} story:`,
			});
			await this.puppet.sendFileDetect(params, imgUrl);
			await this.puppet.sendMessage(params, {
				body: "> " + msg.text,
				formattedBody: `<blockquote>${escapeHtml(msg.text)}</blockquote>`,
			});
		});
		client.on("media_share", async (msg: any, share: any) => {
			log.verbose("Got a media share to pass on");
			let imgUrl;
			try {
				imgUrl = share.image_versions2.candidates[0].url;
			} catch (err) {
				imgUrl = share.carousel_media[0].image_versions2.candidates[0].url;
			}
			const params = this.getSendParams(puppetId, msg);
			const mediaWebUrl = `https://www.instagram.com/p/${share.code}`;
			const user = share.user.username;
			const userWebUrl = `http://www.instagram.com/${user}/`;

			await this.puppet.sendMessage(params, {
				body: `New media by ${user} has been shared: ${mediaWebUrl}`,
				formattedBody: `New media by <a href="${escapeHtml(userWebUrl)}">${escapeHtml(user)}</a> has been shared: <a href="${escapeHtml(mediaWebUrl)}">${escapeHtml(mediaWebUrl)}</a>`,
			});
			await this.puppet.sendFileDetect(params, imgUrl);
			await this.puppet.sendMessage(params, {
				body: "> " + share.caption.text,
				formattedBody: `<blockquote>${escapeHtml(share.caption.text)}</blockquote>`,
			});
		});
		client.on("file", async (msg: any) => {
			log.verbose("Got file message to pass on", msg);
			const params = this.getSendParams(puppetId, msg);
			await this.puppet.sendFileDetect(params, msg.url);
		});
		client.on("userupdate", async (user: any) => {
			await this.puppet.updateUser({
				puppetId,
				userId: user.userId,
				name: user.name,
				avatarUrl: user.avatar,
			});
		});
		client.on("logout", async () => {
			await this.puppet.sendStatusMessage(puppetId, `**disconnected!** You have been logged out!` +
				` Please use \`relink ${puppetId} <username> <password\` to log in again!`);
		});
		try {
			await client.connect();
		} catch (err) {
			log.warn("Failed to connect to client", err);
			await this.puppet.sendStatusMessage(puppetId, err);
			await this.puppet.sendStatusMessage(puppetId, `**disconnected!** You have been logged out!` +
				` Please use \`relink ${puppetId} <username> <password>\` to log in again!`);
		}
	}

	public async deletePuppet(puppetId: number) {
		const p = this.puppets[puppetId];
		if (!p) {
			return; // nothing to do
		}
		await p.client.disconnect();
		delete this.puppets[puppetId];
	}

	public async handleMatrixMessage(room: IRemoteRoom, data: IMessageEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got message to send on");
		const eventId = await p.client.sendMessage(room.roomId, data.body);
		if (eventId) {
			await this.puppet.eventSync.insert(room, data.eventId!, eventId);
		}
	}

	public async handleMatrixImage(room: IRemoteRoom, data: IFileEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got image to send on");
		const buffer = await Util.DownloadFile(data.url);
		const eventId = await p.client.sendPhoto(room.roomId, buffer);
		if (eventId) {
			await this.puppet.eventSync.insert(room, data.eventId!, eventId);
		}
	}

	public async handleMatrixFile(room: IRemoteRoom, data: IFileEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got file to send on");
		const url = data.url.replace("http://localhost", "https://example.com");
		const name = data.filename;
		const eventId = await p.client.sendLink(room.roomId, name, url);
		if (eventId) {
			await this.puppet.eventSync.insert(room, data.eventId!, eventId);
		}
	}
}
