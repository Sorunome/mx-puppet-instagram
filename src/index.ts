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
		retData.success = true;
		retData.data = {
			username: parts[0],
			password: parts[1],
		};
		return retData;
	});
	puppet.setBotHeaderMsgHook((): string => {
		return "Instagram Puppet Bridge";
	});
	await puppet.start();
}

// tslint:disable-next-line:no-floating-promises
run(); // start the thing!
