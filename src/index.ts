import {
	PuppetBridge,
	IPuppetBridgeFeatures,
	IPuppetBridgeRegOpts,
	Log,
	IRetData,
} from "mx-puppet-bridge";
import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";
import { Instagram } from "./instagram";
import * as escapeHtml from "escape-html";
import { IgApiClient, IgCheckpointError } from "instagram-private-api";
import { Cookie } from "tough-cookie";

const log = new Log("InstagramPuppet:index");

const commandOptions = [
	{ name: "register", alias: "r", type: Boolean },
	{ name: "registration-file", alias: "f", type: String },
	{ name: "config", alias: "c", type: String },
	{ name: "help", alias: "h", type: Boolean },
];
const options = Object.assign({
	"register": false,
	"registration-file": "instagram-registration.yaml",
	"config": "config.yaml",
	"help": false,
}, commandLineArgs(commandOptions));

if (options.help) {
	// tslint:disable-next-line:no-console
	console.log(commandLineUsage([
		{
			header: "Matrix Instagram Puppet Bridge",
			content: "A matrix puppet bridge for instagram",
		},
		{
			header: "Options",
			optionList: commandOptions,
		},
	]));
	process.exit(0);
}

const features = {
	image: true,
	file: true,
//	presence: true,
//	typingTimeout: 5500,
} as IPuppetBridgeFeatures;

const puppet = new PuppetBridge(options["registration-file"], options.config, features);

if (options.register) {
	// okay, all we have to do is generate a registration file
	puppet.readConfig();
	try {
		puppet.generateRegistration({
			prefix: "_instagrampuppet_",
			id: "instagram-puppet",
			url: `http://${puppet.Config.bridge.bindAddress}:${puppet.Config.bridge.port}`,
		} as IPuppetBridgeRegOpts);
	} catch (err) {
		// tslint:disable-next-line:no-console
		console.log("Couldn't generate registration file:", err);
	}
	process.exit(0);
}

async function run() {
	await puppet.init();
	const ig = new Instagram(puppet);
	puppet.on("puppetNew", ig.newPuppet.bind(ig));
	puppet.on("puppetDelete", ig.deletePuppet.bind(ig));
	puppet.on("message", ig.handleMatrixMessage.bind(ig));
	puppet.on("image", ig.handleMatrixImage.bind(ig));
	puppet.on("file", ig.handleMatrixFile.bind(ig));
	puppet.setCreateUserHook(ig.createUser.bind(ig));
	puppet.setGetDastaFromStrHook(async (str: string): Promise<IRetData> => {
		const retData = {
			success: false,
		} as IRetData;
		const parts = str.split(" ");
		if (parts.length < 2) {
			retData.error = "Please specify both username and password";
			return retData;
		}

		const igc = new IgApiClient();
		const getSessionCookie = async (sessRetData: IRetData): Promise<IRetData> => {
			const sessionidCookie = (await igc.state.serializeCookieJar()).cookies.find((c) => {
				return c.key === "sessionid";
			});
			if (!sessionidCookie || !sessionidCookie.value) {
				sessRetData.error = "Invalid session id";
				return sessRetData;
			}
			sessRetData.success = true;
			sessRetData.data = {
				sessionid: sessionidCookie.value,
			};
			return sessRetData;
		};
		if (parts[0] === "sessionid") {
			const sessionid = parts[1];
			const cookies = { 
				storeType: 'MemoryCookieStore',
				rejectPublicSuffixes: true,
				cookies: [
					new Cookie({
						key: "sessionid",
						value: sessionid,
						domain: "instagram.com",
						path: "/",
		 				secure: true,
		 				httpOnly: true,
		 				hostOnly: false,
						maxAge: 31536000,
						creation: new Date(),
					}),
				]
			};
			await igc.state.deserializeCookieJar(JSON.stringify(cookies));
		} else {
			log.verbose("Using username");
			const username = parts[0];
			const password = parts[1];
			igc.state.generateDevice(username);
			await igc.simulate.preLoginFlow();
			try {
				const auth = await igc.account.login(username, password);
				await igc.account.currentUser();
				log.verbose(auth);
			} catch (err) {
				log.verbose(err);
				if (err instanceof IgCheckpointError) {
					log.verbose("Requesting 2fa token");
					log.verbose(igc.state.checkpoint); // Checkpoint info here
					await igc.challenge.auto(true); // Requesting sms-code or click "It was me" button
					console.log(igc.state.checkpoint); // Challenge info here
					retData.error = "Please enter your 2fa code:";
					retData.fn = async (code: string) => {
						const newRetData = {
							success: false,
						} as IRetData;
						log.verbose(code);
						
						const ret = await igc.challenge.sendSecurityCode(code)
						
						log.verbose(ret);
						return await getSessionCookie(newRetData);
					};
					return retData;
				} else {
					retData.error = "Invalid username or password";
					return retData;
				}
			}
		}
		return await getSessionCookie(retData);
	});
	puppet.setBotHeaderMsgHook((): string => {
		return "Instagram Puppet Bridge";
	});
	await puppet.start();
}

// tslint:disable-next-line:no-floating-promises
run(); // start the thing!
