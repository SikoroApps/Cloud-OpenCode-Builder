package com.sikorokoro44.cloudopencode

import com.sikorokoro44.cloudopencode.data.network.CloudApiClientImpl
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudApiClientSecureUrlTest {
    private val client = CloudApiClientImpl("https://api.example.invalid", emptySet())

    @Test
    fun requiresHttpsScheme() {
        assertTrue(client.isSecureUrl("https://api.example.invalid/health"))
        assertFalse(client.isSecureUrl("http://api.example.invalid/health"))
    }

    @Test
    fun allowlistCanRestrictHosts() {
        val restricted = CloudApiClientImpl("https://api.example.invalid", setOf("api.example.invalid"))
        assertTrue(restricted.isSecureUrl("https://api.example.invalid/health"))
        assertFalse(restricted.isSecureUrl("https://evil.example.invalid/health"))
    }
}
