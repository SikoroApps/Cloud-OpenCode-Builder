package com.sikorokoro44.cloudopencode.backend

import java.util.UUID

enum class BuildStatus { QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED }

data class BuildJob(
    val id: String = UUID.randomUUID().toString(),
    val repositoryFullName: String,
    val commitSha: String,
    val status: BuildStatus = BuildStatus.QUEUED,
    val progressPercent: Int = 0,
    val artifactUrl: String? = null,
    val errorMessage: String? = null,
)

/** In-memory reference core for cloud build orchestration. */
class BuildOrchestrator {
    private val jobs = linkedMapOf<String, BuildJob>()

    fun createJob(repositoryFullName: String, commitSha: String): BuildJob {
        require(repositoryFullName.matches(Regex("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"))) {
            "repositoryFullName must be owner/repo"
        }
        require(commitSha.matches(Regex("[0-9a-f]{7,40}"))) { "invalid commit sha" }
        val job = BuildJob(repositoryFullName = repositoryFullName, commitSha = commitSha)
        jobs[job.id] = job
        return job
    }

    fun start(id: String): BuildJob? = update(id) {
        if (it.status == BuildStatus.QUEUED) it.copy(status = BuildStatus.RUNNING, progressPercent = 1) else it
    }

    fun progress(id: String, percent: Int): BuildJob? = update(id) {
        if (it.status != BuildStatus.RUNNING) return@update it
        val bounded = percent.coerceIn(1, 99)
        if (bounded >= it.progressPercent) it.copy(progressPercent = bounded) else it
    }

    fun succeed(id: String, artifactUrl: String): BuildJob? = update(id) {
        it.copy(status = BuildStatus.SUCCEEDED, progressPercent = 100, artifactUrl = artifactUrl)
    }

    fun fail(id: String, errorMessage: String): BuildJob? = update(id) {
        it.copy(status = BuildStatus.FAILED, errorMessage = errorMessage)
    }

    fun get(id: String): BuildJob? = jobs[id]

    private fun update(id: String, transform: (BuildJob) -> BuildJob): BuildJob? {
        val existing = jobs[id] ?: return null
        val updated = transform(existing)
        jobs[id] = updated
        return updated
    }
}
