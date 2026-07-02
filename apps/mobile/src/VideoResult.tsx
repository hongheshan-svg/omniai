import { ResizeMode, Video } from "expo-av";
import { View, Text, StyleSheet } from "react-native";
import { formatDuration } from "./resultModel";

export function VideoResult({
  uri,
  posterUrl,
  durationSeconds
}: {
  uri: string;
  posterUrl: string;
  durationSeconds: number;
}) {
  return (
    <View>
      <Video
        source={{ uri }}
        posterSource={{ uri: posterUrl }}
        usePoster
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        style={styles.video}
      />
      <Text>时长 {formatDuration(durationSeconds)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: 240, height: 160, marginTop: 8 }
});
