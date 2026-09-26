"use client";

import { useState } from "react";
import type { Assessment } from "@/lib/advice";
import { ChatPanel } from "./ChatPanel";
import { NegotiatePanel } from "./NegotiatePanel";
import { ResultsPanel } from "./ResultsPanel";
import { SalaryForm, type FormValues } from "./SalaryForm";
import type { Meta } from "./types";

type SubmitResponse = {
  accepted: boolean;
  status?: string;
  heldForReview?: boolean;
  assessment?: Assessment;
  message?: string;
  notes?: string[];
  issues?: { field: string; message: string }[];
  error?: string;
};

export function SaltorApp({ meta }: { meta: Meta }) {
  const [values, setValues] = useState<FormValues | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(next: FormValues) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data: SubmitResponse = await response.json();

      if (response.status === 400) {
        setError(
          data.issues?.map((i) => i.message).join(" · ") ?? data.error ?? "Please check your answers.",
        );
        return;
      }
      if (!data.accepted) {
        setNotice(data.message ?? "That report wasn't added to the dataset.");
        return;
      }

      setValues(next);
      setAssessment(data.assessment ?? null);
      if (data.heldForReview) {
        setNotice(
          "Your report is unusual enough that it's held for review before it counts towards benchmarks. Your own results below are unaffected.",
        );
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const profile = values
    ? {
        roleSlug: values.roleSlug,
        citySlug: values.citySlug,
        yearsExperience: values.yearsExperience,
        companyType: values.companyType,
        currentTotalInr:
          values.annualBaseInr + values.annualBonusInr + values.annualEquityInr,
        lastRaisePct: values.lastRaisePct,
        monthsSinceRaise: values.monthsSinceRaise,
      }
    : null;

  return (
    <>
      <div className="steps">
        <span className={assessment ? "" : "on"}>1 · Your details</span>
        <span>→</span>
        <span className={assessment ? "on" : ""}>2 · Where you stand</span>
        <span>→</span>
        <span className={assessment ? "on" : ""}>3 · What to say</span>
      </div>

      {!assessment && <SalaryForm meta={meta} onSubmit={submit} busy={busy} />}

      {error && (
        <div className="note bad" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="note warn" style={{ marginTop: 16 }}>
          {notice}
        </div>
      )}

      {assessment && (
        <>
          <ResultsPanel assessment={assessment} />
          {values && assessment.action !== "hold" && <NegotiatePanel values={values} />}
          <ChatPanel profile={profile} aiEnabled={meta.aiEnabled} />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAssessment(null);
                setValues(null);
                setNotice(null);
              }}
            >
              Start over
            </button>
          </div>
        </>
      )}

      {!assessment && <ChatPanel profile={null} aiEnabled={meta.aiEnabled} />}
    </>
  );
}
