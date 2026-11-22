"use client";

import type { FilterRule } from "@crm/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const FilterDraft = createContext<RefObject<FilterRule | undefined> | null>(
  null,
);

export function AssistantFilterDraftProvider({
  children,
}: {
  children: ReactNode;
}) {
  const draft = useRef<FilterRule | undefined>(undefined);
  return <FilterDraft.Provider value={draft}>{children}</FilterDraft.Provider>;
}

export function useEditorDraft() {
  return useContext(FilterDraft);
}

export function usePublishEditorDraft(rule: FilterRule) {
  const draftRef = useEditorDraft();
  useEffect(() => {
    if (!draftRef) return;
    draftRef.current = rule;
    return () => {
      draftRef.current = undefined;
    };
  }, [draftRef, rule]);
}
