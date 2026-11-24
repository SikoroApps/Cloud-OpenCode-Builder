package com.sikorokoro44.cloudopencode.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.IvParameterSpec
import java.security.SecureRandom

class EncryptedTokenStore(private val context: Context) {
    private val keyAlias = "cloud_opencode_token_key"
    private val prefs = context.getSharedPreferences("cloud_opencode_token", Context.MODE_PRIVATE)

    fun save(token: String) {
        prefs.edit().putString("token", encrypt(token)).apply()
    }

    fun load(): String? = decrypt(prefs.getString("token", null))

    fun clear() = prefs.edit().remove("token").apply()

    private fun encrypt(plain: String): String {
        val key = keyStoreKey()
        val iv = ByteArray(12)
        SecureRandom().nextBytes(iv)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, IvParameterSpec(iv))
        val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
        return android.util.Base64.encodeToString(combined, android.util.Base64.NO_WRAP)
    }

    private fun decrypt(value: String?): String? {
        if (value == null) return null
        val combined = android.util.Base64.decode(value, android.util.Base64.NO_WRAP)
        if (combined.size <= 12) return null
        val iv = combined.copyOf(12)
        val ciphertext = ByteArray(combined.size - 12)
        System.arraycopy(combined, 12, ciphertext, 0, ciphertext.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, keyStoreKey(), IvParameterSpec(iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    private fun keyStoreKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KeyStore.getDefaultType())
        keyStore.load(null)
        if (!keyStore.containsAlias(keyAlias)) {
            val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KeyProperties.KEY_STORE)
            val spec = KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                KeyProperties.AES256_GCM,
            ).setBlockModes(KeyProperties.BLOCK_MODE_AES_GCM)
                .setEncryptionPaddings(KeyProperties.PADDING_GCM)
                .build()
            keyGenerator.init(spec)
            keyStore.setEntry(keyAlias, keyGenerator.generateKey(), null)
        }
        return keyStore.getKey(keyAlias, null) as SecretKey
    }
}
