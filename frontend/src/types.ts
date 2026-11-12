import type { Dispatch, SetStateAction } from 'react'

export interface Resource { id: string; name: string }
export interface ChannelResource extends Resource { type: number; canSend?: boolean; parentId?: string | null }
export interface Resources { roles: Resource[]; channels: ChannelResource[] }
export interface RolePrefix { roleId: string; prefix: string }
export type SettingValue = string | boolean | RolePrefix[]
export interface SettingField { key: string; label: string; type: string; channelTypes?: number[]; value: SettingValue }
export interface TemplateField { key: string; group: string; label: string; type: string; value: string; components?: boolean; maxLength?: number; variables?: string[]; default?: string }
export type PreviewField = Pick<TemplateField, 'type' | 'value'> & Partial<TemplateField>
export interface Binding { link: string; fields?: TemplateField[] }
export interface SyncResult { kind: string; ok: boolean; error?: string; logError?: string; updated?: number }
export interface Config { revision: number; templateVariables?: Record<string, Record<string, string>>; templates: TemplateField[]; settings: SettingField[]; bindings: Record<string, Binding>; syncResults?: SyncResult[] }
export type Drafts = Record<string, Record<string, string>>
export type SettingsDraft = Record<string, SettingValue>
export type Setter<T> = Dispatch<SetStateAction<T>>
export type Notify = (message: string, error?: boolean) => void
export type Run = (work: () => Promise<unknown>) => Promise<unknown>
export interface Guild { id: string; name: string }
export interface Session { csrf: string; guild: Guild; user: Resource & { avatar?: string } }
export interface MclList { id: string; title: string; channelId: string; roleId: string; accessRoleId?: string; addName: string; removeName: string }
export interface CapturePreset { id: string; command: string; target: string; channelId: string; accessRoleId: string; maxMain: number }
export interface SourceMessage { url: string; channelId: string; canEdit: boolean; revision: string }
export type ComponentItem = { type: 'text' | 'image' | 'section'; value: string; btnLabel?: string; btnLink?: string } | { type: 'separator'; spacing?: string; divider?: boolean; large?: boolean }
export interface ComponentParser { parse(source: string): ComponentItem[]; stringify(items: ComponentItem[]): string }
export interface Decision { static?: string; excluded?: boolean; tierRoleId?: string; reset?: boolean }
export interface PreviewRow { discordId: string; currentNickname: string | null; currentRoleIds?: string[]; static?: string; gameRank?: string; status: string; nickname?: string | null; addRoles?: string[]; removeRoles?: string[]; preservedTier?: boolean; reason?: string; roleNote?: string }
export interface MajesticPreview { id: string; generatedAt: number; familyTotal: number; rows: PreviewRow[]; summary: Record<string, number>; invalidated?: boolean }
export interface MajesticState { busy: boolean; configured: boolean; decisions: Record<string, Decision>; rankRoles: Record<string, string>; preview: MajesticPreview | null; run: { kind: string; status: string; completed: number; total: number; stopRequested?: boolean; error?: string; results: { before?: string; discordId: string; status: string; error?: string }[] } | null }
export interface HistoryChange { label?: string; before?: unknown; after?: unknown }
export interface HistoryDetails { actorName?: string; error?: string; fields?: Record<string, HistoryChange>; changes?: Record<string, unknown>; before?: Record<string, unknown>; diff?: string; outcome?: string; logError?: string; syncResults?: SyncResult[] }
export interface HistoryEntry { id: string | number; action: string; actor: string; target: string; created_at: string; details?: HistoryDetails | string | null }
export interface Overview { ready: boolean; ping: number; database: boolean; uptime: number; history: HistoryEntry[] }
export interface ApiRoutes {
  config: Config; resources: Resources; session: Session; overview: Overview; history: HistoryEntry[];
  'mcl-lists': { lists: MclList[]; revision: number }; majestic: MajesticState;
  'capture-presets': { presets: CapturePreset[]; revision: number };
  'template-variables': Config; templates: Config; 'templates/create': Config; 'templates/delete': Config; settings: Config; 'permanent-message': Config; 'permanent-message/publish': Config; 'permanent-message/sync': Config; 'navigation/sync': Config;
  'role-prefixes/sync': { updated: number; unchanged: number; skipped: number; failed: number };
  'send-container': { success: boolean; error?: string; logError?: string }; 'edit-container': ApiRoutes['send-container'] & { source: SourceMessage };
  logout: { success: boolean }
}
export type Api = {
  <P extends keyof ApiRoutes>(path: P, body?: unknown): Promise<ApiRoutes[P]>;
  (path: `container-message?${string}`, body?: unknown): Promise<{ items: ComponentItem[]; source: SourceMessage }>;
  (path: `channel-threads/${string}`, body?: unknown): Promise<ChannelResource[]>;
  (path: `majestic/${string}`, body?: unknown): Promise<MajesticState>;
}
export interface PageServices { api: Api; run: Run; notify: Notify }
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
export function errorStatus(error: unknown): number | undefined { return error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined }
declare global {
  interface Window { componentMarkdown: ComponentParser; discordMarkdownToHtml(source: string): string; setDiscordMentionResources(resources: Resources): void }
}
