"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { NativeSelect } from "@/components/learning/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SOURCE_TYPES, SOURCE_TYPE_LABELS, onboardingCopy, requestCopy } from "@/lib/copy-learning";
import type { LearningSourceType } from "@/lib/db/schema/enums";

type StartMode = "HAVE_PROJECT" | "STARTING_ONE";

const TOTAL_STEPS = 2;
const source = onboardingCopy.source;
const project = onboardingCopy.project;

/** Two questions, one at a time, everything optional. One request at the end creates it all. */
export function OnboardingFlow({ greeting }: { greeting: string }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(1);
  const [type, setType] = useState<LearningSourceType>("COURSE");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [term, setTerm] = useState("");
  const [mode, setMode] = useState<StartMode | "">("");
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Move focus to the new question so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (step > 1) heading.current?.focus();
  }, [step]);

  async function finish(options: { skipProject?: boolean; skipEverything?: boolean }) {
    setPending(true);
    setError(null);
    const withSource = !options.skipEverything && title.trim() !== "";
    const withProject = !options.skipEverything && !options.skipProject && name.trim() !== "";
    try {
      await apiRequest("/api/v1/onboarding", {
        method: "POST",
        body: {
          ...(withSource ? { source: { type, title, code, term } } : {}),
          ...(withProject ? { project: { name, problemStatement: why } } : {}),
          ...(mode && !options.skipEverything ? { startMode: mode } : {}),
        },
      });
      router.replace("/today");
      router.refresh();
    } catch (caught) {
      const fields = caught instanceof ApiError ? caught.fieldErrors() : {};
      const first = Object.values(fields)[0];
      setError(first ?? (caught instanceof ApiError ? caught.message : requestCopy.unexpected));
      setPending(false);
    }
  }

  const choices: { value: StartMode; title: string; hint: string }[] = [
    { value: "HAVE_PROJECT", ...project.have },
    { value: "STARTING_ONE", ...project.starting },
  ];

  return (
    <div className="bg-card space-y-6 rounded-2xl border p-5 sm:p-7">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {greeting} · {onboardingCopy.stepLabel(step, TOTAL_STEPS)}
      </p>

      {step === 1 ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            setStep(2);
          }}
        >
          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-semibold text-balance">{source.heading}</h2>
            <p className="text-muted-foreground text-sm text-pretty">{source.description}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="onboarding-type">{source.typeLabel}</Label>
            <NativeSelect
              id="onboarding-type"
              value={type}
              onChange={(event) => setType(event.target.value as LearningSourceType)}
              className="h-10"
            >
              {SOURCE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_TYPE_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="onboarding-title">{source.titleLabel}</Label>
            <Input
              id="onboarding-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={source.titlePlaceholder}
              maxLength={120}
              aria-describedby="onboarding-title-hint"
              className="h-10"
            />
            <p id="onboarding-title-hint" className="text-muted-foreground text-xs">
              {source.titleHint}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="onboarding-code">{source.codeLabel}</Label>
              <Input
                id="onboarding-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={source.codePlaceholder}
                maxLength={30}
                className="h-10"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="onboarding-term">{source.termLabel}</Label>
              <Input
                id="onboarding-term"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={source.termPlaceholder}
                maxLength={30}
                className="h-10"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="h-10 px-4">
              {source.continue}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-4"
              onClick={() => {
                setTitle("");
                setCode("");
                setTerm("");
                setStep(2);
              }}
            >
              {source.skip}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void finish({});
          }}
        >
          <div className="space-y-1.5">
            <h2
              ref={heading}
              tabIndex={-1}
              className="font-display text-2xl font-semibold text-balance outline-none"
            >
              {project.heading}
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">{project.description}</p>
          </div>

          <fieldset className="grid gap-2">
            <legend className="sr-only">{project.choicesLabel}</legend>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as StartMode)}
              className="grid gap-2"
            >
              {choices.map((choice) => (
                <Label
                  key={choice.value}
                  htmlFor={`onboarding-${choice.value}`}
                  className="border-input has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-secondary/60 flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal"
                >
                  <RadioGroupItem
                    id={`onboarding-${choice.value}`}
                    value={choice.value}
                    className="mt-0.5"
                  />
                  <span className="grid gap-0.5 leading-snug">
                    <span className="font-medium">{choice.title}</span>
                    <span className="text-muted-foreground text-xs">{choice.hint}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>

          <div className="grid gap-1.5">
            <Label htmlFor="onboarding-name">{project.nameLabel}</Label>
            <Input
              id="onboarding-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={project.namePlaceholder}
              maxLength={120}
              className="h-10"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="onboarding-why">{project.whyLabel}</Label>
            <Input
              id="onboarding-why"
              value={why}
              onChange={(event) => setWhy(event.target.value)}
              placeholder={project.whyPlaceholder}
              maxLength={300}
              aria-describedby="onboarding-why-hint"
              className="h-10"
            />
            <p id="onboarding-why-hint" className="text-muted-foreground text-xs">
              {project.optionalHint}
            </p>
          </div>

          <div aria-live="polite">
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error} {onboardingCopy.error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending} className="h-10 px-4">
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? project.finishing : project.finish}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              className="h-10 px-4"
              onClick={() => void finish({ skipProject: true })}
            >
              {project.skip}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              className="h-10 px-4"
              onClick={() => setStep(1)}
            >
              {project.back}
            </Button>
          </div>
        </form>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => void finish({ skipEverything: true })}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-sm underline underline-offset-4 outline-none focus-visible:ring-3 disabled:opacity-50"
      >
        {onboardingCopy.skipAll}
      </button>
    </div>
  );
}
