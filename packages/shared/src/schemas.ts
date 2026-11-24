import { z } from 'zod';
import { CATEGORIES, LIFECYCLES } from './constants.js';

export const deploymentConfigSchema = z.object({
  provider: z.enum(['firebase', 'none']).default('none'),
  firebaseProjectId: z.string().trim().max(200).default(''),
  hostingSiteId: z.string().trim().max(200).default(''),
  remotePath: z.string().trim().max(500).default('/'),
  publicUrl: z.string().trim().max(1000).default(''),
  deployDirectory: z.string().trim().max(500).default('.'),
});

const commandsSchema = z.record(z.string().max(80), z.string().max(2000).optional()).default({});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  rootPath: z.string().trim().min(1).max(1000),
  category: z.enum(CATEGORIES).optional(),
  lifecycle: z.enum(LIFECYCLES).optional(),
  technologies: z.array(z.string().max(60)).max(50).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  monitoringEnabled: z.boolean().optional(),
  gitEnabled: z.boolean().optional(),
  deploymentMonitoring: z.boolean().optional(),
  deployment: deploymentConfigSchema.partial().optional(),
  commands: commandsSchema.optional(),
  thumbnailPath: z.string().max(1000).optional(),
});

export const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  category: z.enum(CATEGORIES),
  lifecycle: z.enum(LIFECYCLES),
  technologies: z.array(z.string().max(60)).max(50),
  tags: z.array(z.string().max(60)).max(50),
  monitoringEnabled: z.boolean(),
  gitEnabled: z.boolean(),
  deploymentMonitoring: z.boolean(),
  favorite: z.boolean(),
  importance: z.enum(['low', 'medium', 'high', 'critical']),
  genre: z.string().max(100),
  version: z.string().max(50),
  repoUrl: z.string().max(1000),
  devUrl: z.string().max(1000),
  devPort: z.number().int().min(1).max(65535).nullable(),
  deployment: deploymentConfigSchema.partial(),
  commands: commandsSchema,
  ignoreRules: z.array(z.string().max(300)).max(200),
  thumbnailPath: z.string().max(1000).nullable(),
}).partial();

export const discoverSchema = z.object({ rootPath: z.string().trim().min(1).max(1000), maxDepth: z.number().int().min(1).max(4).optional() });
export const bulkRegisterSchema = z.object({ projects: z.array(projectCreateSchema).min(1).max(500) });

export const taskSchema = z.object({
  projectId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(500),
  status: z.enum(['todo', 'doing', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().max(30).nullable().optional(),
});
export const noteSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().max(200_000).default(''),
  kind: z.enum(['note', 'idea', 'bug', 'tech', 'prd']).default('note'),
});

export const launchSchema = z.object({
  action: z.enum(['open_folder', 'open_editor', 'open_terminal', 'run', 'stop', 'restart']),
  command: z.string().max(80).optional(),
  processId: z.string().max(100).optional(),
});

export const deploySchema = z.object({ confirmToken: z.string().min(8).max(200), skipBuild: z.boolean().optional() });

export const dependencySchema = z.object({ dependencyId: z.string().min(1), version: z.string().max(100).optional(), detail: z.string().max(500).optional() });

export const prioritySchema = z.object({
  daysPending: z.number().min(0).max(3650),
  changedFiles: z.number().min(0).max(1_000_000),
  importance: z.enum(['low', 'medium', 'high', 'critical']),
  buildHasErrors: z.boolean(),
});
