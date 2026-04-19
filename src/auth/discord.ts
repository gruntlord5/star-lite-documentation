export function discord() {
	return {
		id: "discord",
		label: "Discord",
		adminEntry: new URL("./discord-admin.tsx", import.meta.url).pathname,
	};
}
