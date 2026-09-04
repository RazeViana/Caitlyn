import type { ChatMessage, ChatRole } from "../types/models.js";

const conversationMap = new Map<string, ChatMessage[]>();
const CONVERSATION_MEMORY_SIZE = Number(
	process.env.CONVERSATION_MEMORY_SIZE
);

function getConversation(key: string): ChatMessage[] {
	if (!conversationMap.has(key)) {
		conversationMap.set(key, []);
	}
	return conversationMap.get(key)!;
}

function addMessage(key: string, role: ChatRole, content: string): void {
	const convo = getConversation(key);
	convo.push({ role, content });

	if (convo.length > CONVERSATION_MEMORY_SIZE) {
		convo.splice(0, convo.length - CONVERSATION_MEMORY_SIZE);
	}
}

function resetConversation(key: string): void {
	conversationMap.delete(key);
}

export { addMessage, getConversation, resetConversation };
