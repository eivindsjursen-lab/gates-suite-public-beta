export interface WorkflowRun {
  id: number;
  workflow_id: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | undefined;
  run_attempt?: number | undefined;
}

export interface WorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: WorkflowStep[] | undefined;
}

export interface WorkflowStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface GatesApiClientOptions {
  token: string;
  owner: string;
  repo: string;
  apibudgetCalls: number;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface ApiBudgetState {
  used: number;
  limit: number;
  exhausted: boolean;
}
