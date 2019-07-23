import {
	PuppetBridge,
	Log,
	IReceiveParams,
	IMessageEvent,
	IRemoteUser,
	IRemoteChan,
	IFileEvent,
	Util,
} from "mx-puppet-bridge";
import { Client } from "./client";

const log = new Log("InstagramPuppet:instagram");

interface IInstagramPuppet {
	client: Client;
	data: any;
}

interface IInstagramPuppets {
    [puppetId: number] :IInstagramPuppet;
}

export class Instagram {
	private puppets: IInstagramPuppets = {};
	constructor(
		private puppet: PuppetBridge,
	) { }

	public getSendParams(puppetId: number, msg: any): IReceiveParams {
		let eventId: string | undefined;
		if (msg.eventId) {
			eventId = msg.eventId;
		}
		return {
			chan: {
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
		const client = new Client(data.username, data.password);
		this.puppets[puppetId] = {
			client,
			data,
		} as IInstagramPuppet;
		client.on("message", async (msg: any) => {
			log.verbose("Got message to pass on", msg);
			const params = this.getSendParams(puppetId, msg);
			await this.puppet.sendMessage(params, {
				body: msg.text,
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
		})
		await client.connect();
	}

	public async deletePuppet(puppetId: number) {
		const p = this.puppets[puppetId];
		if (!p) {
			return; // nothing to do
		}
		await p.client.disconnect();
		delete this.puppets[puppetId];
	}

	public async handleMatrixMessage(room: IRemoteChan, data: IMessageEvent, event: any) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		log.verbose("Got message to send on");
		const eventId = await p.client.sendMessage(room.roomId, data.body);
		if (eventId) {
			await this.puppet.eventStore.insert(room.puppetId, data.eventId!, eventId);
		}
	}

	public async handleMatrixFile(room: IRemoteChan, data: IFileEvent, event: any) {
		
	}
}
