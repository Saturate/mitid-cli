import { describe, expect, it } from "vitest";
import { simulatorUrl } from "../src/identity.js";

describe("simulatorUrl", () => {
	it("builds correct simulator URL for pp environment", () => {
		const url = simulatorUrl(
			"abc-123",
			"A-1234-5678-9012",
			"https://pp.mitid.dk",
		);
		expect(url).toBe(
			"https://pp.mitid.dk/test-tool/code-app-simulator/#/abc-123/details/A-1234-5678-9012",
		);
	});

	it("builds correct simulator URL for production", () => {
		const url = simulatorUrl(
			"abc-123",
			"A-1234-5678-9012",
			"https://www.mitid.dk",
		);
		expect(url).toBe(
			"https://www.mitid.dk/test-tool/code-app-simulator/#/abc-123/details/A-1234-5678-9012",
		);
	});
});
