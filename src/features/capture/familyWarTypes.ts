import type { GuildMember } from 'discord.js'
import type { MemberDecision } from '../../types'

export interface WarPlayer { id: number; name: string; familyId?: number; damage?: number; kills?: number }
export interface RawWar { id: number; captureId?: number | null; defendersId: number; attackersId: number; startAt: string; defendersName?: string; attackersName?: string; status?: string; players?: Record<string, WarPlayer[]>; gangZoneId?: string | number; selectedMapName?: string; winner?: number | string | null; winnerId?: number | string | null; winnerFamilyId?: number | string | null }
export interface WarRules { closed: Set<string>; neutralIds: Set<string>; neutralNames: Set<string> }
export interface War { key: string; apiId: number | string; captureId: number | null; attack: boolean; enemy: string; zone?: string | number; map: string; startAt: number; status: string; neutral: boolean; closed: boolean; updatedAt: number; roster: { static: string; name: string }[]; rosterFresh: boolean; rosterUpdatedAt: number | null; raw: RawWar; testSource?: { apiId: number | string; startAt: number } }
export interface Registration { joins?: Record<string, { joinedAt: number }>; seen?: Record<string, number>; declined?: Record<string, number | boolean>; sortMode?: string; closedAt?: number; announcementFinished?: boolean; announcementVersion?: string; page?: number }
export interface WarRow { guild_id: string; war_key: string; data: War; registration: Registration; announcement_id?: string | null; announcement_channel_id?: string | null; announcement_state?: string | null; registration_id?: string | null; registration_channel_id?: string | null; registration_state?: string | null }
export interface QueueRow { userId: string | null; static: string | null; name: string; confirmed: boolean; conflict: boolean; joinedAt: number; declined?: boolean }
export type BindingMember = Pick<GuildMember, 'id' | 'nickname' | 'user'>
export type Decisions = Record<string, MemberDecision>
