package com.sikorokoro44.cloudopencode.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CloudTaskRepositoryTest {
    @Test
    fun createAndRetrieveTask() {
        val repo = CloudTaskRepository()
        val task = repo.create("proj-1", "build apk", 1000L)
        assertNotNull(repo.get(task.id))
        assertEquals("proj-1", repo.get(task.id)?.projectId)
        assertEquals(CloudTaskStatus.QUEUED, repo.get(task.id)?.status)
    }

    @Test
    fun updateStatusChangesTask() {
        val repo = CloudTaskRepository()
        val task = repo.create("proj-1", "build apk", 1000L)
        val updated = repo.updateStatus(task.id, CloudTaskStatus.SUCCEEDED, 2000L)
        assertNotNull(updated)
        assertEquals(CloudTaskStatus.SUCCEEDED, updated?.status)
        assertEquals(2000L, updated?.updatedAtMillis)
    }

    @Test
    fun updateUnknownReturnsNull() {
        val repo = CloudTaskRepository()
        assertNull(repo.updateStatus("missing", CloudTaskStatus.FAILED, 1L))
    }

    @Test
    fun listFiltersByProject() {
        val repo = CloudTaskRepository()
        repo.create("a", "t1", 1L)
        repo.create("b", "t2", 2L)
        assertEquals(1, repo.list("a").size)
        assertEquals(2, repo.list().size)
    }

    @Test
    fun blankProjectIdRejected() {
        val repo = CloudTaskRepository()
        try {
            repo.create("", "t", 1L)
            org.junit.Assert.fail("expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }
}