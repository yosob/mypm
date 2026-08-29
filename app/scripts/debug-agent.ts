import { makeAgent } from "../src/agent";

const agent = makeAgent("debug");
agent.subscribe((event: any) => {
	const t = event.type;
	if (t === "message_end") {
		console.log("message_end role=", event.message.role, JSON.stringify(event.message.content)?.slice(0, 300));
	} else if (t === "message_update") {
		// 流式增量忽略
	} else if (t === "tool_execution_end") {
		console.log("tool_end", event.toolName, "isError=", event.isError, JSON.stringify(event.result)?.slice(0, 200));
	} else if (t === "agent_end") {
		console.log("agent_end stopReason=", event.messages?.at(-1)?.stopReason, "errMsg=", event.messages?.at(-1)?.errorMessage);
	} else {
		console.log("event:", t);
	}
});
try {
	await agent.prompt("你好，请回复OK");
	await agent.waitForIdle();
} catch (e) {
	console.error("PROMPT ERROR:", e);
}
