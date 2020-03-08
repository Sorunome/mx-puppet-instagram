import { IgApiClient } from "instagram-private-api";
import { IRetData } from "mx-puppet-bridge";
import { Cookie } from "tough-cookie";

export const getSessionCookie = async (igc: IgApiClient, sessRetData: IRetData): Promise<IRetData> => {
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

export const fillCookieJar = async (igc: IgApiClient, sessionid: string) => {
	const cookies = {
		storeType: "MemoryCookieStore",
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
		],
	};
	await igc.state.deserializeCookieJar(JSON.stringify(cookies));
};
