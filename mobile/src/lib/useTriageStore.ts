import { create } from 'zustand';
import type { SlaConfig, TriageEvaluation, PreemptionDecision } from '../types';
import { api } from './api';
import { log } from './debug';

interface TriageState {
  priorities: SlaConfig[];
  evaluations: TriageEvaluation[];
  decisions: PreemptionDecision[];
  loading: boolean;
  lastEvaluatedAt: string | null;
  breachCount: number;
  warningCount: number;

  fetchPriorities: () => Promise<void>;
  runEvaluation: () => Promise<void>;
  executePreemption: (deliveryId: string) => Promise<void>;
  fetchDecisions: () => Promise<void>;
}

export const useTriageStore = create<TriageState>((set, get) => ({
  priorities: [],
  evaluations: [],
  decisions: [],
  loading: false,
  lastEvaluatedAt: null,
  breachCount: 0,
  warningCount: 0,

  fetchPriorities: async () => {
    try {
      const res = await api.get<{ data: { priorities: SlaConfig[]; crdt_state: any } }>('/triage/priorities');
      set({ priorities: res.data.priorities });
    } catch (err) {
      log('error', 'Failed to fetch priorities', (err as Error).message);
    }
  },

  runEvaluation: async () => {
    set({ loading: true });
    try {
      const res = await api.post<{ data: { evaluations: TriageEvaluation[]; breach_count: number; warning_count: number; evaluated_at: string } }>('/triage/evaluate', {});
      set({
        evaluations: res.data.evaluations,
        breachCount: res.data.breach_count,
        warningCount: res.data.warning_count,
        lastEvaluatedAt: res.data.evaluated_at,
        loading: false,
      });
    } catch (err) {
      log('error', 'Failed to evaluate triage', (err as Error).message);
      set({ loading: false });
    }
  },

  executePreemption: async (deliveryId: string) => {
    try {
      const res = await api.post<{ data: PreemptionDecision }>('/triage/preempt', { delivery_id: deliveryId });
      set((state) => ({
        decisions: [res.data, ...state.decisions],
      }));
      // Re-evaluate after preemption
      get().runEvaluation();
    } catch (err) {
      log('error', 'Failed to execute preemption', (err as Error).message);
    }
  },

  fetchDecisions: async () => {
    try {
      const res = await api.get<{ data: { decisions: PreemptionDecision[] } }>('/triage/decisions');
      set({ decisions: res.data.decisions });
    } catch (err) {
      log('error', 'Failed to fetch decisions', (err as Error).message);
    }
  },
}));
