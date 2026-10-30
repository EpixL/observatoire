/**
 * Types du dashboard : DÉDUITS des schémas zod de src/schema.ts (source unique).
 * Le contrat en prose est dans docs/api-contract.md ; le backend fait foi (docs/api-contract-backend-proposal.md).
 */
import type { z } from 'zod';
import type * as S from './schema';

type T<K extends z.ZodType> = z.infer<K>;

export type Palier = T<typeof S.PalierSchema>;
export type Trend = T<typeof S.TrendSchema>;
export type TrendInfo = T<typeof S.TrendInfoSchema>;
export type GaugeState = T<typeof S.GaugeStateSchema>;
export type Territory = T<typeof S.TerritorySchema>;
export type CoverageFamily = T<typeof S.CoverageFamilySchema>;
export type Coverage = T<typeof S.CoverageSchema>;
export type Criterion = T<typeof S.CriterionSchema>;
export type PalierDef = T<typeof S.PalierDefSchema>;
export type GaugeDetail = T<typeof S.GaugeDetailSchema>;
export type GaugeHistory = T<typeof S.GaugeHistorySchema>;
export type HypothesisId = T<typeof S.HypothesisIdSchema>;
export type Hypothesis = T<typeof S.HypothesisSchema>;
export type HypothesisVerdict = Hypothesis['verdict'];
export type Conclusion = T<typeof S.ConclusionSchema>;
export type SourceKind = T<typeof S.SourceKindSchema>;
export type LayerId = T<typeof S.LayerIdSchema>;
export type ReadingStatus = T<typeof S.ReadingStatusSchema>;
export type ExclusionReason = T<typeof S.ExclusionReasonSchema>;
export type EventSource = T<typeof S.EventSourceSchema>;
export type EventLocation = T<typeof S.EventLocationSchema>;
export type LocationPrecision = Extract<EventLocation, { kind: 'point' }>['precision'];
export type CriterionEffect = T<typeof S.CriterionEffectSchema>;
export type ProposedLink = T<typeof S.ProposedLinkSchema>;
export type Claim = T<typeof S.ClaimSchema>;
export type Annotation = T<typeof S.AnnotationSchema>;
export type VeilleEvent = T<typeof S.VeilleEventSchema>;
export type Counters = T<typeof S.CountersSchema>;
export type DossierScenario = T<typeof S.DossierScenarioSchema>;
export type HistoryPoint = T<typeof S.HistoryPointSchema>;
export type MethodChange = T<typeof S.MethodChangeSchema>;
export type SourceVerdict = T<typeof S.SourceVerdictSchema>;
export type SourceHealthState = T<typeof S.SourceHealthStateSchema>;
export type SourceRecord = T<typeof S.SourceRecordSchema>;
export type JournalEntry = T<typeof S.JournalEntrySchema>;
export type ReviewItem = T<typeof S.ReviewItemSchema>;
export type CivilAlert = T<typeof S.CivilAlertSchema>;
export type NuclearKind = T<typeof S.NuclearKindSchema>;
export type NuclearBadge = T<typeof S.NuclearBadgeSchema>;
export type AiMode = T<typeof S.AiModeSchema>;
export type AiState = T<typeof S.AiStateSchema>;
export type NotificationLevel = T<typeof S.NotificationLevelSchema>;
export type NotificationSettings = T<typeof S.NotificationSettingsSchema>;
export type ThresholdItem = T<typeof S.ThresholdItemSchema>;
export type ThresholdChange = T<typeof S.ThresholdChangeSchema>;
export type ThresholdsState = T<typeof S.ThresholdsStateSchema>;
export type Snapshot = T<typeof S.SnapshotSchema>;
export type StreamMessage = T<typeof S.StreamMessageSchema>;
