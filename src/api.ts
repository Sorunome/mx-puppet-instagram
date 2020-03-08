import { Response } from "express";
import { PuppetBridge, IAuthedRequest, Log } from "mx-puppet-bridge";
import { IgApiClient, IgCheckpointError, IgLoginTwoFactorRequiredError } from "instagram-private-api";
import { get } from "lodash";
import { fillCookieJar, getSessionCookie } from "./login";

const CREATED = 201;
const ACCEPTED = 202;
const FORBIDDEN = 403;

const log = new Log("InstagramPuppet:api");

export class InstagramProvisioningAPI {
	private clients: { [userId: string]: IgApiClient } = {};
	private secondFactorState: {
		[userId: string]: {
			twoFactorIdentifier: string,
			username: string,
		},
	} = {};

	constructor(
		private puppet: PuppetBridge,
	) {
		const api = puppet.provisioningAPI;
		api.v1.post("/login/cookie", this.loginWithCookie.bind(this));
		api.v1.post("/login/password", this.loginWithPassword.bind(this));
		api.v1.post("/login/checkpoint", this.loginCheckpoint.bind(this));
		api.v1.post("/login/2fa", this.loginSecondFactor.bind(this));
	}

	private getClient(userId: string): IgApiClient {
		let igc = this.clients[userId];
		if (!igc) {
			igc = this.clients[userId] = new IgApiClient();
		}
		return igc;
	}

	private popClient(userId: string): IgApiClient {
		const igc = this.clients[userId];
		delete this.clients[userId];
		return igc;
	}

	private async loginWithCookie(req: IAuthedRequest, res: Response) {
		await fillCookieJar(this.getClient(req.userId), req.body.session_id);
		await this.finishLogin(req.userId, res);
	}

	private async loginWithPassword(req: IAuthedRequest, res: Response) {
		const igc = this.getClient(req.userId);

		igc.state.generateDevice(req.body.username);
		await igc.simulate.preLoginFlow();

		try {
			const auth = await igc.account.login(req.body.username, req.body.password);
			await igc.account.currentUser();
			log.verbose(auth);
		} catch (err) {
			if (err instanceof IgCheckpointError) {
				log.verbose("Requesting \"it was me\" button");
				log.verbose(igc.state.checkpoint); // Checkpoint info here
				await igc.challenge.auto(true);
				log.verbose(igc.state.checkpoint); // Challenge info here
				res.status(ACCEPTED).json({ next_step: "/login/checkpoint" });
			} else if (err instanceof IgLoginTwoFactorRequiredError) {
				const twoFactorIdentifier = get(err, "response.body.two_factor_info.two_factor_identifier");
				if (!twoFactorIdentifier) {
					this.secondFactorState[req.userId] = { twoFactorIdentifier, username: req.body.username };
					res.status(ACCEPTED).json({ next_step: "/login/2fa" });
				} else {
					res.status(FORBIDDEN).json({
						errcode: "M_UNKNOWN",
						error: "Unable to login, no 2fa identifier found",
					});
				}
			} else {
				res.status(FORBIDDEN).json({
					errcode: "M_FORBIDDEN",
					error: "Invalid username or password",
				});
			}
			return;
		}
		await this.finishLogin(req.userId, res);
	}

	private async loginCheckpoint(req: IAuthedRequest, res: Response) {
		try {
			const ret = await this.getClient(req.userId).challenge.sendSecurityCode(req.body.code);
			log.verbose(ret);
		} catch (err) {
			log.warn(err);
			res.status(FORBIDDEN).json({ errcode: "M_FORBIDDEN", error: err.toString() });
			return;
		}
		await this.finishLogin(req.userId, res);
	}

	private async loginSecondFactor(req: IAuthedRequest, res: Response) {
		const igc = this.getClient(req.userId);
		if (!this.secondFactorState.hasOwnProperty(req.userId)) {
			res.status(FORBIDDEN).json({ errcode: "M_FORBIDDEN", error: "Login not started" });
			return;
		}
		const { username, twoFactorIdentifier } = this.secondFactorState[req.userId];
		try {
			let ret;
			try {
				// first try if this is SMS login
				ret = await igc.account.twoFactorLogin({
					username,
					verificationCode: req.body.code,
					twoFactorIdentifier,
					verificationMethod: "1",
				});
			} catch (e) {
				// then try if this is OTP login
				ret = await igc.account.twoFactorLogin({
					username,
					verificationCode: req.body.code,
					twoFactorIdentifier,
					verificationMethod: "0",
				});
			}
			log.verbose(ret);
		} catch (err) {
			log.warn(err);
			res.status(FORBIDDEN).json({ errcode: "M_FORBIDDEN", error: err.toString() });
			return;
		}
		await this.finishLogin(req.userId, res);
	}

	private async finishLogin(userId: string, res: Response) {
		const igc = this.popClient(userId);
		const data = await getSessionCookie(igc, {
			success: false,
		});
		if (!data.success) {
			res.status(FORBIDDEN).json(data);
		} else {
			const puppetId = await this.puppet.provisioner.new(userId, data as any);
			res.status(CREATED).json({ puppet_id: puppetId });
		}
	}
}
