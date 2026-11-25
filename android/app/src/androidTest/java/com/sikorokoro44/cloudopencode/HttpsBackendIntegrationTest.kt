package com.sikorokoro44.cloudopencode

import com.sikorokoro44.cloudopencode.data.network.CloudApiClientImpl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.URI

class HttpsBackendIntegrationTest {
    @Test
    fun clientCommunicatesWithBackendOverHttps() {
        val baseUrl = BuildConfig.CLOUD_BASE_URL
        assumeTrue("CLOUD_BASE_URL is not configured for HTTPS", baseUrl.startsWith("https://"))
        val host = URI(baseUrl).host
        val client = CloudApiClientImpl(baseUrl, setOf(host))

        assertTrue(client.isSecureUrl("$baseUrl/health"))
        assertTrue("health request failed", waitForHealth(client))

        val email = "https-ci-${System.currentTimeMillis()}@example.invalid"
        val token = client.register(email, "password-1234").getOrThrow().token
        val githubStatus = client.githubStatus(token).getOrThrow()
        assertEquals(false, githubStatus.configured)
        assertEquals(false, githubStatus.connected)
        assertTrue(client.githubRepositories(token).isFailure)
        assertTrue(client.selectedGithubProject(token).isFailure)
        assertTrue(client.projectFiles(token).isFailure)
        assertTrue(client.projectCommits(token).isFailure)
        assertTrue(client.builds(token).isFailure)
        assertTrue(client.buildLogs(token, "missing").isFailure)
        assertTrue(client.buildArtifacts(token, "missing").isFailure)
        assertTrue(client.apkDownloadLink(token, "missing", 1).isFailure)
        assertTrue(client.apkChecksum(token, "missing", 1).isFailure)
        assertTrue(client.addLauncherIcon(token).isFailure)
        assertTrue(client.signedReleaseWorkflow(token).isFailure)
        val chat = client.sendChat(token, "https-ci-session", "persist over https").getOrThrow()
        assertEquals("STUB:persist over https", chat.assistantMessage?.content)

        val history = client.history(token, "https-ci-session").getOrThrow()
        assertEquals(2, history.size)
        assertEquals("persist over https", history[0].content)
        assertEquals("STUB:persist over https", history[1].content)

        // Phase 6: upload, list, fetch metadata and understand an image over HTTPS.
        val pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        val uploaded = client.uploadImage(token, "integration.png", "image/png", pngBase64).getOrThrow()
        assertTrue(uploaded.id.isNotBlank())
        assertEquals("image/png", uploaded.mimeType)
        assertEquals("upload", uploaded.source)
        assertTrue(client.listImages(token).getOrThrow().any { it.id == uploaded.id })
        val analysis = client.analyzeImage(token, uploaded.id, "Describe this image").getOrThrow()
        assertEquals(uploaded.id, analysis.imageId)
        assertTrue(analysis.content.startsWith("STUB_IMAGE:"))

        // Phase 7: free-provider stub generation, stored through the same owner-scoped pipeline.
        val generated = client.generateImage(token, "a blue cloud icon", 512).getOrThrow()
        assertEquals("generated", generated.source)
        assertEquals("image/png", generated.mimeType)

        // Phase 8: deterministic search stub and persistent task lifecycle.
        val search = client.webSearch(token, "android compose", 2).getOrThrow()
        assertEquals("stub/local-test", search.provider)
        assertTrue(search.results.isNotEmpty())
        val task = client.createTask(token, "integration task").getOrThrow()
        assertEquals("queued", task.status)
        assertTrue(client.listTasks(token).getOrThrow().any { it.id == task.id })
        assertEquals("running", client.updateTask(token, task.id, "running").getOrThrow().status)
        assertEquals("cancelled", client.cancelTask(token, task.id).getOrThrow().status)

        assertTrue("logout failed", client.logout(token).isSuccess)
    }

    private fun waitForHealth(client: CloudApiClientImpl): Boolean {
        repeat(6) { attempt ->
            if (client.health().isSuccess) return true
            if (attempt < 5) Thread.sleep(2_000)
        }
        return false
    }
}
