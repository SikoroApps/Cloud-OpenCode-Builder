package com.sikorokoro44.cloudopencode.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class EncryptedTokenStore(private val context: Context) {
    private val keyAlias = "cloud_opencode_token_key"
    private val prefs = context.getSharedPreferences("cloud_opencode_token", Context.MODE_PRIVATE)

    fun save(token: String) {
        prefs.edit().putString("token", encrypt(token)).apply()
    }

    fun load(): String? = decrypt(prefs.getString("token", null))

    fun clear() = prefs.edit().remove("token").apply()

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, keyStoreKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
        return android.util.Base64.encodeToString(combined, android.util.Base64.NO_WRAP)
    }

    private fun decrypt(value: String?): String? {
        if (value == null) return null
        return runCatching {
            val combined = android.util.Base64.decode(value, android.util.Base64.NO_WRAP)
            if (combined.size <= GCM_IV_LENGTH) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                keyStoreKey(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, combined, 0, GCM_IV_LENGTH),
            )
            val ciphertext = ByteArray(combined.size - GCM_IV_LENGTH)
            System.arraycopy(combined, GCM_IV_LENGTH, ciphertext, 0, ciphertext.size)
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        }.getOrNull()
    }

    private fun keyStoreKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val existing = keyStore.getKey(keyAlias, null)
        if (existing is SecretKey) return existing
        val spec = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val GCM_IV_LENGTH = 12
        const val GCM_TAG_LENGTH_BITS = 128
    }
}
