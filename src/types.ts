import type { Client, Guild, GuildMember, Collection, Message, RepliableInteraction, SlashCommandBuilder, ContextMenuCommandBuilder } from 'discord.js'
import type { Pool } from 'pg'

export type Env = NodeJS.ProcessEnv
export interface Actor { id: string; name?: string }
export interface RolePrefix { roleId: string; prefix: string }
export interface TemplateField {
	key?: string
	group: string
	label: string
	type: string
	default?: string
	value?: string
	maxLength?: number
	variables?: string[]
	components?: boolean
}
export interface Binding {
	link: string
	messageId?: string
	channelId?: string
	containerIndex?: number
	prefixLength?: number
	fields: (TemplateField & { key: string; path?: string })[]
	[key: string]: unknown
}
export interface CapturePreset {
	id: string
	command: string
	target: string
	channelId: string
	accessRoleId: string
	maxMain: number
}
export interface MclList {
	id: string
	title: string
	channelId: string
	roleId: string
	accessRoleId?: string
	addName: string
	removeName: string
}
export type SettingValue = string | boolean | RolePrefix[]
/** Editable subset of Discord JSON. Unrecognised properties are checked by import validation. */
export interface RawComponent {
	type: number
	toJSON?: () => RawComponent
	id?: number
	custom_id?: string
	content?: string
	label?: string | null
	url?: string | null
	style?: number
	components?: RawComponent[]
	accessory?: RawComponent
	items?: { media: { url: string }; description?: string | null; spoiler?: boolean }[]
	accent_color?: number | null
	spacing?: number
	divider?: boolean
	disabled?: boolean
	emoji?: unknown
	spoiler?: boolean
}
export type ComponentSource = RawComponent | { toJSON(): RawComponent }
export interface MutableMessagePayload { components: ComponentSource[]; content?: string; flags?: import('discord.js').MessageFlags; allowedMentions?: import('discord.js').MessageMentionOptions; attachments?: import('discord.js').MessageEditOptions['attachments']; files?: import('discord.js').MessageCreateOptions['files'] }
export interface MessageShape {
	components: ComponentSource[]
	flags: Pick<import('discord.js').MessageFlagsBitField, 'has' | 'bitfield'>
	content: string
	attachments: ReadonlyMap<string, unknown>
	embeds: readonly unknown[]
	editedTimestamp?: number | null
	url?: string
}
export interface EditorItem { id?: string; type: string; value?: string; btnLabel?: string; btnLink?: string; spacing?: string; divider?: boolean; large?: boolean }
export interface ContainerData { noColor?: boolean; accentColor?: string; items: EditorItem[] }
export interface EditableField { path: string; label: string; value: string; maxLength: number; type: string; components?: boolean }
export interface DashboardState {
	templates: Record<string, string>
	templateVariables?: Record<string, Record<string, string>>
	templateVariableLabels?: Record<string, Record<string, string>>
	settings: Record<string, SettingValue>
	settingsEnvMigrated?: boolean
	bindings?: Record<string, Binding>
	mclLists?: Record<string, MclList>
	capturePresets?: Record<string, CapturePreset>
}
export interface SettingDefinition {
	label: string
	type: string
	channelTypes?: number[]
	default?: boolean | string
}
export type Store = ReturnType<typeof import('./dashboard/store').createStore>
export interface ServiceOptions { client: Client; pool: Pool; store: Store; env?: Env; logger?: Pick<Console, 'log' | 'error' | 'warn'> }
export interface MembershipSnapshot {
	members: Collection<string, GuildMember>
	statics: Set<string>
	linked: Map<string, string>
	bindings: Record<string, string>
	source: string
}
export interface FamilyCharacter { id: number; login: string; rankId: number; rankName: string }
export interface FamilyMembers { total: number; items: FamilyCharacter[] }
export interface MemberDecision { static?: string; excluded?: boolean; tierRoleId?: string }
export interface PreviewRow {
	discordId: string
	currentNickname: string | null
	currentRoleIds?: string[]
	status: string
	static?: string
	gameRank?: string
	nickname?: string | null
	addRoles?: string[]
	removeRoles?: string[]
	preservedTier?: boolean
	roleNote?: string
	reason?: string
	error?: string
}
export type GuildInteraction = RepliableInteraction<'cached'>
export interface PrefixCommand { name: string; description?: string; execute(message: Message<true>, args: string[]): unknown }
export interface ApplicationCommand { data: SlashCommandBuilder | ContextMenuCommandBuilder; execute(interaction: GuildInteraction): unknown }
export type BotCommand = PrefixCommand | ApplicationCommand

declare module 'discord.js' {
	interface Client<Ready extends boolean = boolean> {
		commands: Collection<string, BotCommand>
		mclLists?: ReturnType<typeof import('./services/mclLists').createMclLists>
		capturePresets?: ReturnType<typeof import('./features/capture/capturePresets').createCapturePresets>
		familyWars?: ReturnType<typeof import('./services/familyWars').createFamilyWars> | null
		majesticSync?: ReturnType<typeof import('./services/majesticSync').createMajesticSync>
		majesticNicknames?: ReturnType<typeof import('./services/majesticNicknameScheduler').createMajesticNicknameScheduler>
		familyMembership?: ReturnType<typeof import('./services/familyMembership').createFamilyMembership> | null
		eventSchedule?: ReturnType<typeof import('./services/eventSchedule').createEventSchedule> | null
		stopTelegramBroadcast?: () => Promise<void>
	}
}

declare global {
	namespace Express {
		interface Request { guild: Guild; dashboardUser: Actor; csrf: string }
	}
}

export function componentJSON(component: ComponentSource): RawComponent {
 return (component.toJSON ? component.toJSON() : component) as RawComponent
}
export interface SyncResult { kind: string; ok: boolean; error?: string; logError?: string; updated?: number; failures?: unknown[] }
