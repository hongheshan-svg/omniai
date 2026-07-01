import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { createApiClient, type ApiClient, type CreationMode, filterCreationAssets, getAssetFilterLabel, getAssetModeLabel, summarizeAssetPrompt, type AssetFilter } from "@gw-link-omniai/shared";
import { createSecureTokenStore, type TokenStore } from "./src/tokenStore";
import { createMobileAppController, type MobileAppController } from "./src/appModel";

interface AppProps {
  apiClient?: ApiClient;
  tokenStore?: TokenStore;
  controller?: MobileAppController;
}

export default function App({
  apiClient = createApiClient(),
  tokenStore = createSecureTokenStore(),
  controller
}: AppProps) {
  const ctrl = useMemo(
    () => controller ?? createMobileAppController({ apiClient, tokenStore }),
    [controller, apiClient, tokenStore]
  );
  const state = useSyncExternalStore(ctrl.subscribe, ctrl.getState);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<CreationMode>("text");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");

  useEffect(() => {
    void ctrl.restore();
  }, [ctrl]);

  return (
    <SafeAreaView style={styles.container}>
      {state.stage === "signedOut" && (
        <View>
          <Text>邮箱登录</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="email@example.com" style={styles.input} />
          <Button title="发送验证码" onPress={() => void ctrl.startLogin(email)} />
          {state.actionError ? <Text style={styles.error}>{state.actionError}</Text> : null}
        </View>
      )}

      {state.stage === "signingIn" && (
        <View>
          <Text>请输入邮箱中的验证码</Text>
          <TextInput value={code} onChangeText={setCode} placeholder="123456" style={styles.input} />
          <Button title="验证登录" onPress={() => void ctrl.verifyLogin(code)} />
          {state.actionError ? <Text style={styles.error}>{state.actionError}</Text> : null}
        </View>
      )}

      {state.stage === "signedIn" && (
        <>
          <View style={styles.header}>
            <Text>积分：{state.balance ?? "..."}</Text>
            <Button title="登出" onPress={() => void ctrl.signOut()} />
          </View>
          <View style={styles.form}>
            <TextInput value={prompt} onChangeText={setPrompt} placeholder="描述你想生成的内容" multiline style={styles.input} />
            <Picker selectedValue={mode} onValueChange={(value) => setMode(value as CreationMode)}>
              <Picker.Item label="文本" value="text" />
              <Picker.Item label="图片" value="image" />
              <Picker.Item label="视频" value="video" />
            </Picker>
            <Button
              title="生成"
              onPress={() => {
                void ctrl.submitGeneration({ prompt, mode });
                setPrompt("");
              }}
            />
            {state.actionError ? <Text style={styles.error}>{state.actionError}</Text> : null}
          </View>
          <FlatList
            data={state.tasks}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.task}>
                <Text>ID: {item.id}</Text>
                <Text>状态: {item.status}</Text>
                <Text>提示词: {item.prompt}</Text>
                {item.result?.kind === "text" ? <Text numberOfLines={2}>结果: {item.result.text}</Text> : null}
                {item.status === "running" ? (
                  <Button title="刷新状态" onPress={() => void ctrl.refreshTask(item.id)} />
                ) : null}
                {item.status === "succeeded" ? (
                  <Button title="保存到资产库" onPress={() => void ctrl.saveAsset(item)} />
                ) : null}
              </View>
            )}
          />
          <View style={styles.assetHeader}>
            <Text>资产库</Text>
            <View style={styles.filterRow}>
              {(["all", "text", "image", "video"] as AssetFilter[]).map((filter) => (
                <Button key={filter} title={getAssetFilterLabel(filter)} onPress={() => setAssetFilter(filter)} />
              ))}
            </View>
          </View>
          <FlatList
            data={filterCreationAssets(state.assets, assetFilter)}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.task}>
                <Text>{getAssetModeLabel(item.mode)}</Text>
                <Text numberOfLines={1}>{summarizeAssetPrompt(item)}</Text>
              </View>
            )}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  form: { marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 8, marginBottom: 8 },
  task: { padding: 8, borderBottomWidth: 1, borderColor: "#ccc" },
  error: { color: "red", marginTop: 8 },
  assetHeader: { marginTop: 16, marginBottom: 8 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 }
});
