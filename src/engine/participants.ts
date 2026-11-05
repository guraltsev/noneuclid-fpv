/**
 * Participants and control slots of the world engine (design 013 sections 5.1 and 5.4).
 * A participant is someone acting in the world; its record is immutable and a body write replaces it and appends to the participant journal, which has the interface of the registry's change journal. Control slots are latest-value-wins inputs, opened and closed by commands and sampled once per step.
 */
import { ChangeOp, createRuntimeObjectChangeJournal, type RuntimeObjectChangeRecorder } from "../world-objects/runtimeObjectChangeJournal";
import type { ParticipantAttachment, ParticipantBody, ParticipantRecord, PlainData } from "./moduleTypes";

/** Id of the participant the local device plays. */
export const localParticipantId = "local";
/** Owner id of participants the local device controls. */
export const localDeviceId = "local-device";

/** Creates the record of the local player. */
export function createLocalPlayerParticipant(body: ParticipantBody, attachments: readonly ParticipantAttachment[] = []): ParticipantRecord {
  return { id: localParticipantId, kind: "local-player", ownerId: localDeviceId, body, attachments };
}

/** The participants of one engine. */
export interface ParticipantTable {
  get(id: string): ParticipantRecord | undefined;
  /** In creation order (a fresh array). */
  list(): readonly ParticipantRecord[];
  /** Calls `fn` for each participant in creation order; allocates nothing. */
  forEach(fn: (participant: ParticipantRecord) => void): void;
  /** Replaces the attachments of a participant and records the write; false for an unknown participant. Callers are the modules owning the attachment kinds. */
  setAttachments(id: string, attachments: readonly ParticipantAttachment[]): boolean;
  /** Replaces the body of a participant `deviceId` owns; false, changing nothing, for an unknown participant or another owner. */
  publishBody(id: string, body: ParticipantBody): boolean;
  readonly journal: RuntimeObjectChangeRecorder<ParticipantRecord>;
}

/** Creates the table holding `initial`; `deviceId` is the device this engine serves. */
export function createParticipantTable(initial: readonly ParticipantRecord[], deviceId: string): ParticipantTable {
  const byId = new Map<string, ParticipantRecord>();
  for (const record of initial) {
    if (byId.has(record.id)) throw new Error(`Participant "${record.id}" is listed twice.`);
    byId.set(record.id, record);
  }
  const order = [...byId.keys()];
  const journal = createRuntimeObjectChangeJournal<ParticipantRecord>();
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
    forEach(fn) {
      for (const record of order) fn(byId.get(record)!);
    },
    setAttachments(id, attachments) {
      const existing = byId.get(id);
      if (existing === undefined) return false;
      const next: ParticipantRecord = { ...existing, attachments };
      byId.set(id, next);
      journal.record(ChangeOp.Updated, next);
      return true;
    },
    publishBody(id, body) {
      const existing = byId.get(id);
      if (existing === undefined || existing.ownerId !== deviceId) return false;
      const next: ParticipantRecord = { ...existing, body };
      byId.set(id, next);
      journal.record(ChangeOp.Updated, next);
      return true;
    },
    journal,
  };
}

interface ControlSlot {
  pending: PlainData | undefined;
  value: PlainData | undefined;
}

/** The control slots of one engine, keyed by participant and slot name. */
export interface ControlSlots {
  open(participantId: string, slot: string): void;
  close(participantId: string, slot: string): void;
  /** Sets the pending value of an open slot; ignored for a closed one. */
  set(participantId: string, slot: string, value: PlainData): void;
  /** The value sampled at the last step. */
  get(participantId: string, slot: string): PlainData | undefined;
  /** Phase 2 of a step: the latest values become the sampled ones. */
  sample(): void;
}

/** Creates an empty slot table. */
export function createControlSlots(): ControlSlots {
  const slots = new Map<string, ControlSlot>();
  const keyOf = (participantId: string, slot: string): string => `${participantId}\u0000${slot}`;
  return {
    open(participantId, slot) {
      const key = keyOf(participantId, slot);
      if (!slots.has(key)) slots.set(key, { pending: undefined, value: undefined });
    },
    close(participantId, slot) {
      slots.delete(keyOf(participantId, slot));
    },
    set(participantId, slot, value) {
      const entry = slots.get(keyOf(participantId, slot));
      if (entry) entry.pending = value;
    },
    get: (participantId, slot) => slots.get(keyOf(participantId, slot))?.value,
    sample() {
      if (slots.size === 0) return;
      for (const entry of slots.values()) entry.value = entry.pending;
    },
  };
}
