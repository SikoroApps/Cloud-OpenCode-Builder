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
        assertTrue("health request failed", client.health().isSuccess)

        val email = "https-ci-${System.currentTimeMillis()}@example.invalid"
        val token = client.register(email, "password-1234").getOrThrow().token
        val chat = client.sendChat(token, "https-ci-session", "persist over https").getOrThrow()
        assertEquals("STUB:persist over https", chat.assistantMessage?.content)

        val history = client.history(token, "https-ci-session").getOrThrow()
        assertEquals(2, history.size)
        assertEquals("persist over https", history[0].content)
        assertEquals("STUB:persist over https", history[1].content)
        assertTrue("logout failed", client.logout(token).isSuccess)
    }
}
