package com.sikorokoro44.cloudopencode

import com.sikorokoro44.cloudopencode.data.network.BuildArtifact
import com.sikorokoro44.cloudopencode.data.network.ProjectBuild
import com.sikorokoro44.cloudopencode.ui.ApkDelivery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApkDeliveryTest {
    private fun build(status: String, conclusion: String?) = ProjectBuild(
        id = "build-1",
        status = status,
        conclusion = conclusion,
        progress = if (status == "completed") 100 else 50,
        workflowPath = ".github/workflows/android-ci.yml",
        ref = "main",
        runId = 42,
        runUrl = "https://github.com/example/repo/actions/runs/42",
        logsUrl = null,
        error = null,
        createdAt = 0,
        updatedAt = 0,
    )

    private fun artifact(id: Long, name: String, size: Long = 1024) = BuildArtifact(
        id = id,
        name = name,
        sizeInBytes = size,
        expired = false,
        createdAt = 0,
        downloadUrl = "/api/projects/build/artifact?buildId=build-1&artifactId=$id",
        browserUrl = "https://github.com/example/repo/actions/runs/42",
    )

    @Test
    fun onlySuccessfulCompletedBuildsAreReady() {
        assertTrue(ApkDelivery.buildReady(build("completed", "success")))
        assertFalse(ApkDelivery.buildReady(build("completed", "failure")))
        assertFalse(ApkDelivery.buildReady(build("in_progress", null)))
        assertFalse(ApkDelivery.buildReady(null))
    }

    @Test
    fun deliveryMessagesExplainBlockedStates() {
        assertTrue(ApkDelivery.deliveryStatusMessage(null).contains("Select"))
        assertTrue(ApkDelivery.deliveryStatusMessage(build("in_progress", null)).contains("in_progress"))
        assertTrue(ApkDelivery.deliveryStatusMessage(build("completed", "failure")).contains("failure"))
        assertTrue(ApkDelivery.deliveryStatusMessage(build("completed", "success")).contains("succeeded"))
    }

    @Test
    fun prefersApkNamedArtifactThenDebugThenFirst() {
        val apk = artifact(3, "release-apk")
        val debug = artifact(2, "cloud-opencode-debug")
        val tests = artifact(1, "unit-test-results")
        assertEquals(apk, ApkDelivery.preferredArtifact(listOf(tests, debug, apk)))
        assertEquals(debug, ApkDelivery.preferredArtifact(listOf(tests, debug)))
        assertEquals(tests, ApkDelivery.preferredArtifact(listOf(tests)))
        assertNull(ApkDelivery.preferredArtifact(emptyList()))
    }

    @Test
    fun formatsFileSizesForDisplay() {
        assertEquals("512 B", ApkDelivery.formatFileSize(512))
        assertEquals("1.00 KiB", ApkDelivery.formatFileSize(1024))
        assertEquals("9.78 MiB", ApkDelivery.formatFileSize(10_251_687))
    }
}
