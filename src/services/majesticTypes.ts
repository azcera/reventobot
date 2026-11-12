import type { MemberDecision } from '../types'
import type { PlannedRow } from '../features/majestic/syncPreview'
export interface SyncPreview { id: string; generatedAt: number; source: string; familyTotal: number; rows: PlannedRow[]; summary: Record<string, number>; invalidated?: boolean }
export interface SyncResult { discordId: string; status: string; before?: string | null; nickname?: string | null; addRoles?: string[]; removeRoles?: string[]; error?: string }
export interface SyncRun { id: string; kind: string; status: string; startedAt: number; finishedAt?: number; total: number; completed: number; results: SyncResult[]; stopRequested: boolean; error?: string; summary?: Record<string, number> }
export interface SyncState { decisions: Record<string, MemberDecision>; preview: SyncPreview | null; run: SyncRun | null; familyMembership?: { source: string; bindings: Record<string, string>; confirmed?: Record<string, { static: string; seenAt: number; joinedAt: number }>; autoKickSince?: number } }
export interface SyncEntry { state: SyncState; busy: boolean; writes: Promise<unknown>; task: Promise<void> | null }
export type RunningEntry = SyncEntry & { state: SyncState & { run: SyncRun } }
