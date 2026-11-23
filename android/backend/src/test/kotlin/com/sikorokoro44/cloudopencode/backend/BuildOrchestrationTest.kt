package com.sikorokoro44.cloudopencode.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BuildOrchestrationTest {
    @Test
    fun createStartProgressSucceed() {
        val orchestrator = BuildOrchestrator()
        val job = orchestrator.createJob("SikoroApps/Cloud-OpenCode-Builder", "abc1234")
        assertEquals(BuildStatus.QUEUED, job.status)
        assertEquals(BuildStatus.RUNNING, orchestrator.start(job.id)?.status)
        assertEquals(50, orchestrator.progress(job.id, 50)?.progressPercent)
        val done = orchestrator.succeed(job.id, "https://example.invalid/app.apk")
        assertEquals(BuildStatus.SUCCEEDED, done?.status)
        assertEquals(100, done?.progressPercent)
    }

    @Test
    fun progressNeverGoesBackwards() {
        val orchestrator = BuildOrchestrator()
        val job = orchestrator.createJob("owner/repo", "abcdef1")
        orchestrator.start(job.id)
        orchestrator.progress(job.id, 80)
        assertEquals(80, orchestrator.progress(job.id, 30)?.progressPercent)
    }

    @Test
    fun progressIsBounded() {
        val orchestrator = BuildOrchestrator()
        val job = orchestrator.createJob("owner/repo", "abcdef1")
        orchestrator.start(job.id)
        assertEquals(1, orchestrator.progress(job.id, -5)?.progressPercent)
        assertEquals(99, orchestrator.progress(job.id, 150)?.progressPercent)
    }

    @Test
    fun failSetsError() {
        val orchestrator = BuildOrchestrator()
        val job = orchestrator.createJob("owner/repo", "abcdef1")
        assertEquals("compile error", orchestrator.fail(job.id, "compile error")?.errorMessage)
        assertEquals(BuildStatus.FAILED, orchestrator.get(job.id)?.status)
    }

    @Test
    fun invalidRepositoryRejected() {
        val orchestrator = BuildOrchestrator()
        try {
            orchestrator.createJob("not-a-full-name", "abcdef1")
            org.junit.Assert.fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun unknownJobReturnsNull() {
        assertNull(BuildOrchestrator().get("missing"))
    }
}
