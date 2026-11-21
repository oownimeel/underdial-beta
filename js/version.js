// App version, release channel and the list of changes shown in Settings.
// The same files serve both sites; the beta site is told apart by its address,
// and keeps its own data so testing never touches the released app's records.

export const APP_VERSION = "1.2.2";
export const IS_BETA = /\/underdial-beta\//.test(location.pathname);
export const STORAGE_NAME = IS_BETA ? "underdial-beta" : "underdial";

/** Newest first. Korean is the source text; English sits beside it. */
export const CHANGELOG = [
  {
    version: "1.2.2",
    date: "2026-11-21",
    ko: [
      "진폭 기준을 현실에 맞게 바꿨습니다: 250~310°는 양호, 220~250°는 주의, 220° 미만은 점검 권장.",
    ],
    en: [
      "Amplitude ranges now match common practice: 250–310° is good, 220–250° is worth watching, below 220° suggests a service.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-11-21",
    ko: [
      "설정 › 녹음 파일: 모든 녹음을 ZIP 파일 하나로 한 번에 내보낼 수 있습니다.",
      "녹음 파일 이름에 시계 이름과 측정 성공·실패 여부가 들어갑니다.",
    ],
    en: [
      "Settings › Recordings: export every recording at once as one ZIP file.",
      "Recording file names now include the watch and whether the measurement worked.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-21",
    ko: [
      "측정에 실패하면 이유를 알려 줍니다: 소리가 작음, 주변 소음, 부딪힘, 쿼츠 시계, 불규칙한 박동.",
      "신호가 잡히지 않을 때 무엇을 바꿔 보면 좋을지 미리 알려 줍니다.",
      "결과를 한 줄로 풀어 줍니다. 예: \"하루에 약 4초 빨라요\".",
      "오차·진폭·비트 에러가 기준의 어디쯤인지 막대로 보여 줍니다.",
      "점검이 필요해 보이면 이유와 함께 알려 줍니다.",
      "설정 › 의견 보내기: 이 기기의 오류 기록을 복사해 카페에 붙여넣을 수 있습니다.",
      "설정 › 버전 정보에서 업데이트 내역을 볼 수 있습니다.",
    ],
    en: [
      "When a measurement fails, the app says why: too quiet, a noisy room, a knock, a quartz watch, or an uneven beat.",
      "While the signal won't settle, it suggests what to change.",
      "Results come with a plain sentence, such as \"About 4 seconds fast a day\".",
      "Bars show where rate, amplitude and beat error sit against common ranges.",
      "When a watch may need servicing, the app says so and why.",
      "Settings › Send feedback copies this device's error log to paste into the cafe.",
      "Settings › Version shows what changed in each update.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-20",
    ko: ["측정 전에 휴대폰을 시계에 대는 방법을 포지션별 애니메이션으로 보여 줍니다."],
    en: ["Before measuring, an animation shows how to hold the phone against the watch in each position."],
  },
  {
    version: "1.0.1",
    date: "2026-11-20",
    ko: [
      "측정 다이얼이 오른쪽으로 쏠려 보이던 문제를 고쳤습니다.",
      "저장 버튼을 빠르게 두 번 누르면 두 번 저장되던 문제를 고쳤습니다.",
      "시계와 기록이 많을 때 화면이 넘치거나 느려지던 문제를 고쳤습니다.",
    ],
    en: [
      "Fixed the measuring dial sitting off-centre.",
      "Fixed a quick double tap on Save saving twice.",
      "Fixed overflowing and slow screens with many watches and records.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-19",
    ko: ["웹 버전을 처음 공개했습니다."],
    en: ["First web release."],
  },
];
