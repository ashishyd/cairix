/**
 * Which window belongs to which plugin. Plugin identity always comes from here
 * (looked up by the sending window), never from anything inside a message.
 */
export interface HostEndpoint {
  pluginId: string
  onReply(reqId: string, msg: { ok: boolean; result?: unknown; error?: string }): void
}

export const senders = new Map<number, HostEndpoint>()
