package com.sikorokoro44.cloudopencode.backend

import java.util.UUID

enum class CloudTaskStatus { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED }

data class CloudTask(
    val id: String = UUID.randomUUID().toString(),
    val projectId: String,
    val description: String,
    val status: CloudTaskStatus = CloudTaskStatus.QUEUED,
    val createdAtMillis: Long,
    val updatedAtMillis: Long = createdAtMillis,
)

class CloudTaskRepository {
    private val tasks = linkedMapOf<String, CloudTask>()

    fun create(projectId: String, description: String, nowMillis: Long): CloudTask {
        require(projectId.isNotBlank()) { "projectId must not be blank" }
        val task = CloudTask(
            projectId = projectId,
            description = description,
            createdAtMillis = nowMillis,
        )
        tasks[task.id] = task
        return task
    }

    fun get(id: String): CloudTask? = tasks[id]

    fun list(projectId: String? = null): List<CloudTask> =
        tasks.values.filter { projectId == null || it.projectId == projectId }

    fun updateStatus(id: String, status: CloudTaskStatus, nowMillis: Long): CloudTask? {
        val existing = tasks[id] ?: return null
        val updated = existing.copy(status = status, updatedAtMillis = nowMillis)
        tasks[id] = updated
        return updated
    }

    fun size(): Int = tasks.size
}