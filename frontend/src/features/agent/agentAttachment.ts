import {
  parseTrackedOffers,
  type ParsedTrackedOffers,
  type TrackedOffer,
  type TrackedOfferParseDiagnostics,
} from "../offer-performance/performanceModel";

export interface AgentPromotionWindow {
  readonly launchDate: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly beforeStart: string;
  readonly beforeEnd: string;
  readonly days: number;
}

export interface PromotionManifest {
  readonly attachmentId: string;
  readonly fileName: string;
  readonly merchantCount: number;
  readonly merchants: readonly { readonly merchantId: string; readonly merchantName: string }[];
  readonly window: AgentPromotionWindow | null;
}

export interface AgentPromotionAttachment {
  readonly manifest: PromotionManifest;
  readonly offers: readonly TrackedOffer[];
  readonly diagnostics: TrackedOfferParseDiagnostics;
}

export function promotionManifestForRequest(attachment: AgentPromotionAttachment): PromotionManifest {
  return {
    ...attachment.manifest,
    merchants: attachment.manifest.merchants.map((merchant) => ({
      merchantId: merchant.merchantId,
      merchantName: merchant.merchantName.slice(0, 80),
    })),
  };
}

export interface AgentAttachmentStore {
  get(): AgentPromotionAttachment | null;
  replace(attachment: AgentPromotionAttachment): AgentPromotionAttachment;
  setWindow(window: AgentPromotionWindow | null): AgentPromotionAttachment | null;
  clear(): void;
  subscribe(listener: (attachment: AgentPromotionAttachment | null) => void): () => void;
}

interface AttachmentError extends Error {
  readonly code?: "IMPORT_IDS" | "IMPORT_NAMES" | "IMPORT_EMPTY";
}

function attachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneOffers(offers: readonly TrackedOffer[]): TrackedOffer[] {
  return offers.map((offer) => ({
    ...offer,
    asins: [...offer.asins],
  }));
}

function cloneDiagnostics(diagnostics: TrackedOfferParseDiagnostics): TrackedOfferParseDiagnostics {
  return { ...diagnostics };
}

function cloneAttachment(attachment: AgentPromotionAttachment): AgentPromotionAttachment {
  return {
    manifest: {
      ...attachment.manifest,
      merchants: attachment.manifest.merchants.map((merchant) => ({ ...merchant })),
      window: attachment.manifest.window ? { ...attachment.manifest.window } : null,
    },
    offers: cloneOffers(attachment.offers),
    diagnostics: cloneDiagnostics(attachment.diagnostics),
  };
}

function parsedError(code: AttachmentError["code"]): AttachmentError {
  const error = new Error(code || "IMPORT_EMPTY") as AttachmentError;
  Object.defineProperty(error, "code", { value: code || "IMPORT_EMPTY", enumerable: true });
  return error;
}

export function parseAgentAttachment(
  tables: unknown[][][],
  fileName: string,
): AgentPromotionAttachment {
  const parsed: ParsedTrackedOffers = parseTrackedOffers(tables);
  if (!parsed.offers.length || parsed.offers.length > 200) throw parsedError("IMPORT_IDS");
  if (parsed.offers.some((offer) => !offer.merchantName || offer.merchantName.length > 160)) throw parsedError("IMPORT_NAMES");
  const offers = cloneOffers(parsed.offers);
  return {
    manifest: {
      attachmentId: attachmentId(),
      fileName: fileName.trim().slice(0, 160),
      merchantCount: offers.length,
      merchants: offers.map(({ merchantId, merchantName }) => ({ merchantId, merchantName })),
      window: null,
    },
    offers,
    diagnostics: cloneDiagnostics(parsed.diagnostics),
  };
}

export function snapshotAgentAttachment(attachment: AgentPromotionAttachment): AgentPromotionAttachment {
  return cloneAttachment(attachment);
}

export function createAgentAttachmentStore(): AgentAttachmentStore {
  let current: AgentPromotionAttachment | null = null;
  const listeners = new Set<(attachment: AgentPromotionAttachment | null) => void>();
  const notify = () => listeners.forEach((listener) => listener(current ? cloneAttachment(current) : null));
  return {
    get: () => (current ? cloneAttachment(current) : null),
    replace(attachment) {
      current = cloneAttachment(attachment);
      notify();
      return cloneAttachment(current);
    },
    setWindow(window) {
      if (!current) return null;
      current = {
        ...current,
        manifest: { ...current.manifest, window: window ? { ...window } : null },
      };
      notify();
      return cloneAttachment(current);
    },
    clear() {
      if (!current) return;
      current = null;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current ? cloneAttachment(current) : null);
      return () => listeners.delete(listener);
    },
  };
}
