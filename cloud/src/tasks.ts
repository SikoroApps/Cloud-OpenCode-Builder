export const CLOUD_TASK_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

export type CloudTaskStatus = (typeof CLOUD_TASK_STATUSES)[number];

export function isCloudTaskStatus(value: unknown): value is CloudTaskStatus {
  return typeof value === "string" && (CLOUD_TASK_STATUSES as readonly string[]).includes(value);
}

export function validateTaskDescription(raw: unknown): string {
  const description = String(raw || "").replace(/\s+/g, " ").trim();
  if (!description) throw new Error("invalid_task_description");
  if (description.length > 2000) throw new Error("invalid_task_description");
  return description;
}

export function cloudTaskDto(task: any): Record<string, unknown> {
  return {
    id: String(task.id),
    userId: String(task.userId),
    projectId: task.projectId ? String(task.projectId) : null,
    description: String(task.description),
    status: String(task.status),
    createdAt: Number(task.createdAt),
    updatedAt: Number(task.updatedAt),
  };
}
