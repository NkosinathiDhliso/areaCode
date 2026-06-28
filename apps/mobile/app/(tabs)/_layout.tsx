import { Tabs } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import { ConnectivityBanner } from '../../src/components/ConnectivityBanner'

export default function TabsLayout() {
  const { t } = useTranslation()

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0f' }}>
      <ConnectivityBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: 'rgba(18, 18, 24, 0.85)',
            borderTopColor: 'rgba(255,255,255,0.06)',
            borderTopWidth: 1,
            height: 56,
            paddingBottom: 4,
          },
          tabBarActiveTintColor: '#778CA9',
          tabBarInactiveTintColor: '#6b7280',
          tabBarLabelStyle: { fontSize: 10, marginTop: -2 },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t('nav.map'), tabBarLabel: t('nav.map') }} />
        <Tabs.Screen name="leaderboard" options={{ title: t('nav.leaderboard'), tabBarLabel: t('nav.leaderboard') }} />
        <Tabs.Screen name="feed" options={{ title: t('nav.feed'), tabBarLabel: t('nav.feed') }} />
        <Tabs.Screen name="profile" options={{ title: t('nav.profile'), tabBarLabel: t('nav.profile') }} />
      </Tabs>
    </View>
  )
}
