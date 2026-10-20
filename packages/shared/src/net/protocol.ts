/**
 * Shared message protocol (TECH-02). Two layers:
 *  1. Server <-> client over WebSocket: lobby registry, signaling, relay fallback.
 *  2. Host <-> phone over a PeerLink (WebRTC DataChannel or WS relay): game messages.
 */
import type { BotLevel, CharacterId, PlayerColor, RoundCount } from '../config';
import type { ItemId } from '../game/items';
import type { DiceId } from '../game/dice';
import type { Action, GameMode } from '../game/types';
import type { ControllerLayout, MgFormat, MgInput } from '../minigames/types';

// ------------------------------------------------------------------ server layer

export type ClientToServer =
  | { t: 'host.create'; resume?: { code: string; hostToken: string } }
  | { t: 'peer.join'; code: string; sessionToken?: string }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'relay'; to: string; data: unknown }
  | { t: 'host.kick'; peerId: string }
  | { t: 'ping'; ts: number };

export type ServerToClient =
  | { t: 'host.created'; code: string; hostToken: string; resumed: boolean }
  | { t: 'peer.joined'; peerId: string; sessionToken: string; hostOnline: boolean }
  | { t: 'peer.connected'; peerId: string; sessionToken: string }
  | { t: 'peer.left'; peerId: string }
  | { t: 'host.left' }
  | { t: 'host.back' }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'relay'; from: string; data: unknown }
  | { t: 'pong'; ts: number; server: number }
  | { t: 'error'; code: ServerErrorCode };

export type ServerErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'bad_token'
  | 'rate_limited'
  | 'too_many_rooms'
  | 'bad_message'
  | 'kicked';

export const HOST_PEER_ID = 'host';
export const MAX_PEERS_PER_ROOM = 8;

// ------------------------------------------------------------------ game layer

export interface LobbySettings {
  mode: GameMode;
  mapId: string;
  rounds: RoundCount;
  bots: boolean;
  botLevel: BotLevel;
  teamMode: 'fields' | 'random';
  noMotion: boolean;
  disabledMinigames: string[];
}

export interface PlayerInfo {
  slot: number;
  name: string;
  character: CharacterId | null;
  color: PlayerColor;
  isBot: boolean;
  connected: boolean;
  chief: boolean;
}

export interface MeInfo {
  slot: number;
  name: string;
  character: CharacterId | null;
  color: PlayerColor;
  coins: number;
  stars: number;
  items: ItemId[];
  tickets: number;
  starDiscount: boolean;
}

/** Board decision as presented on the phone (host pre-computes everything). */
export type PhoneDecision =
  | { kind: 'orderRoll' }
  /** dice: choices for the second die (the standard die always rolls too) */
  | { kind: 'turnMenu'; canUseItem: boolean; items: { id: ItemId; usable: boolean }[]; dice: DiceId[] }
  | { kind: 'miniPick'; options: number[] }
  | { kind: 'branch'; options: { id: string; angle: number; labelKey?: string; starDistance?: number }[] }
  | { kind: 'shop'; offer: { id: ItemId; price: number; affordable: boolean }[]; full: boolean; titleKey: string }
  | { kind: 'buyStar'; price: number }
  | { kind: 'station'; destinations: { id: string; labelKey: string }[]; hasTicket: boolean; ticketPrice: number; canBuy: boolean }
  | { kind: 'cablecar'; price: number }
  | { kind: 'itemReplace'; newItem: ItemId }
  | { kind: 'duelPick'; options: { player: number; name: string; character: CharacterId; coins: number }[] }
  | { kind: 'wheel'; segments: string[] };

export interface AfkInfo {
  /** seconds until the computer decides for an idle player (BOARD-04) */
  secondsLeft: number;
}

export interface MinigameCatalogEntry {
  id: string;
  format: MgFormat;
  motion: boolean;
}

export type ControllerView =
  | {
      screen: 'lobby';
      players: PlayerInfo[];
      settings: LobbySettings;
      takenCharacters: CharacterId[];
      minigames: MinigameCatalogEntry[];
      maps: { id: string; nameKey: string; descKey: string }[];
      canStart: boolean;
      saveCode?: string | null;
    }
  | { screen: 'claim'; options: { slot: number; name: string; character: CharacterId; taken: boolean }[] }
  | { screen: 'wait'; activePlayer?: number; activeName?: string; message?: { key: string; params?: Record<string, string | number> } }
  | { screen: 'decide'; decision: PhoneDecision }
  | { screen: 'mgIntro'; game: string; layout: ControllerLayout; ready: boolean; format: MgFormat; team: number }
  | { screen: 'mg'; game: string; layout: ControllerLayout; team: number; ended?: boolean }
  | {
      screen: 'over';
      place: number;
      ranking: { slot: number; name: string; stars: number; coins: number; points: number }[];
      mode: GameMode;
      saveCode?: string | null;
    };

export interface ViewEnvelope {
  me: MeInfo | null;
  chief: boolean;
  paused: boolean;
  round?: { round: number; total: number };
  afk?: AfkInfo | null;
  view: ControllerView;
}

export type PhoneToHost =
  | { t: 'hello'; token: string; name: string; motion: boolean }
  | { t: 'pickChar'; character: CharacterId }
  | { t: 'settings'; patch: Partial<LobbySettings> }
  | { t: 'start' }
  | { t: 'kick'; slot: number }
  | { t: 'transferChief'; slot: number }
  | { t: 'claim'; slot: number }
  | { t: 'action'; action: Action }
  | { t: 'mg'; input: MgInput }
  | { t: 'ready' }
  | { t: 'pause'; paused: boolean }
  | { t: 'ff'; on: boolean }
  | { t: 'emoji'; emoji: string }
  | { t: 'time'; id: number; c: number }
  | { t: 'postgame'; choice: 'rematch' | 'lobby' };

export type HostToPhone =
  | { t: 'welcome'; slot: number }
  | { t: 'reject'; reason: 'full' | 'running' | 'nickname' | 'kicked' }
  | { t: 'view'; v: ViewEnvelope }
  | { t: 'time'; id: number; c: number; h: number }
  | { t: 'vibrate'; ms: number };

export const EMOJIS = ['😂', '😱', '😡', '🥳', '👏', '😎'];
