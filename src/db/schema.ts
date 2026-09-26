import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  index,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * One anonymous salary report.
 *
 * There is deliberately no user table and no identifying column: the trust of
 * the whole platform rests on submissions being un-linkable to a person. What
 * we keep instead is `fingerprint`, a coarse hash used only for duplicate
 * detection, which cannot be reversed into an identity.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    roleSlug: text("role_slug").notNull(),
    levelSlug: text("level_slug").notNull(),
    citySlug: text("city_slug").notNull(),
    companyType: text("company_type").notNull(),

    yearsExperience: real("years_experience").notNull(),
    yearsAtCompany: real("years_at_company").notNull(),

    /** Fixed annual base pay, INR. */
    annualBaseInr: integer("annual_base_inr").notNull(),
    /** Cash bonus / variable actually received last year, INR. */
    annualBonusInr: integer("annual_bonus_inr").notNull().default(0),
    /** Annualised value of equity (RSU/ESOP) as reported, INR. */
    annualEquityInr: integer("annual_equity_inr").notNull().default(0),
    /** Denormalised base + bonus + equity so percentile queries stay simple. */
    totalCompInr: integer("total_comp_inr").notNull(),

    /** Most recent raise, in percent. Null when the person has never had one. */
    lastRaisePct: real("last_raise_pct"),
    /** Months since that raise, or since joining if there has been none. */
    monthsSinceRaise: integer("months_since_raise"),

    /** 'seed' rows are generated reference data; 'user' rows are real reports. */
    source: text("source").notNull().default("user"),
    /** 'approved' rows count towards benchmarks; 'pending'/'rejected' do not. */
    status: text("status").notNull().default("approved"),
    /** 0..1 confidence that this row is genuine; scales its benchmark weight. */
    trustScore: real("trust_score").notNull().default(1),
    /** Why the validator flagged it, for the moderation queue. */
    flagReason: text("flag_reason"),

    fingerprint: text("fingerprint"),
    /** Opt-in: may this row be shown as an individual example, not just in aggregate? */
    shareable: boolean("shareable").notNull().default(true),
  },
  (t) => [
    index("submissions_cohort_idx").on(t.roleSlug, t.citySlug, t.status),
    index("submissions_role_idx").on(t.roleSlug, t.status),
    index("submissions_fingerprint_idx").on(t.fingerprint),
  ],
);

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
