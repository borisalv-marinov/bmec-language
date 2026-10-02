import { createKnowledgeContext, type KnowledgeCategory, type KnowledgeIndex } from './knowledge.js';

export interface AiContextOptions {
  category?: KnowledgeCategory;
  limit?: number;
}

/** Build a bounded, task-focused context pack using the same ranked catalog as `bmec knowledge`. */
export function createAiTaskContext(task: string, index: KnowledgeIndex, options: AiContextOptions = {}) {
  const cleanTask = task.trim();
  if (!cleanTask) throw new Error('BMEC-AI-001: provide a task, for example bmec ai context "add an authenticated route"');
  return {
    schemaVersion: 'bmec.ai-task-context.v1' as const,
    task: cleanTask,
    knowledge: createKnowledgeContext(cleanTask, index, options),
  };
}
