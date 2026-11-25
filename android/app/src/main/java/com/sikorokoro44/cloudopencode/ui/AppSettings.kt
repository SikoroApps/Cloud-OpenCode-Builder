package com.sikorokoro44.cloudopencode.ui

import android.content.Context

/**
 * Non-secret UI preferences. Tokens remain in the AndroidKeyStore-backed EncryptedTokenStore;
 * nothing here holds credentials or provider keys.
 */
class AppSettings(context: Context) {
    private val prefs = context.getSharedPreferences("cloud_opencode_settings", Context.MODE_PRIVATE)

    var onboardingComplete: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDING_COMPLETE, false)
        set(value) {
            prefs.edit().putBoolean(KEY_ONBOARDING_COMPLETE, value).commit()
        }

    var webSearch: Boolean
        get() = prefs.getBoolean(KEY_WEB_SEARCH, false)
        set(value) {
            prefs.edit().putBoolean(KEY_WEB_SEARCH, value).commit()
        }

    var themeMode: String
        get() = prefs.getString(KEY_THEME_MODE, THEME_SYSTEM) ?: THEME_SYSTEM
        set(value) {
            prefs.edit().putString(KEY_THEME_MODE, value).commit()
        }

    var selectedTab: Int
        get() = prefs.getInt(KEY_SELECTED_TAB, 0)
        set(value) {
            prefs.edit().putInt(KEY_SELECTED_TAB, value).commit()
        }

    fun chatSessionKey(): String = prefs.getString(KEY_CHAT_SESSION, DEFAULT_SESSION) ?: DEFAULT_SESSION

    fun saveChatSessionKey(value: String) {
        prefs.edit().putString(KEY_CHAT_SESSION, value.ifBlank { DEFAULT_SESSION }).commit()
    }

    private companion object {
        const val KEY_ONBOARDING_COMPLETE = "onboarding_complete"
        const val KEY_WEB_SEARCH = "web_search"
        const val KEY_THEME_MODE = "theme_mode"
        const val KEY_SELECTED_TAB = "selected_tab"
        const val KEY_CHAT_SESSION = "chat_session"
        const val DEFAULT_SESSION = "default"
        const val THEME_SYSTEM = "system"
    }
}
