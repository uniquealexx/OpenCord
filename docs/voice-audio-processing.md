# Voice Processing (English)

When noise suppression is enabled, OpenCord processes the local microphone with the RNNoise model before publishing the track to LiveKit. The model and the WebAssembly code ship with the client: the audio is not sent to any external service and does not leave the normal media path of the voice room.

## Media path

1. LiveKit captures a monophonic 48 kHz signal with echo cancellation and the automatic gain control selected by the user.
2. An `AudioWorklet` performs RNNoise filtering off the main renderer thread.
3. 8% of the original signal is mixed back into the processed signal so that quiet consonants and word endings are not cut off.
4. The voice gate smoothly (12 ms to open, 40 ms to close) attenuates the signal below the activation threshold so that background noise does not leak into the channel.
5. A `MediaStreamAudioDestinationNode` returns the processed track to LiveKit for publication.

Processing runs locally and off the main renderer thread. The model is loaded only when the microphone track is created. If AudioWorklet or WebAssembly fails to start, the client keeps the voice session and uses Chromium's standard WebRTC noise suppression; the gate keeps working meanwhile if Web Audio is available.

RNNoise is not a full copy of the commercial Krisp: it is a local speech filter with no cloud dependency. The choice of `@sapphi-red/web-noise-suppressor` is pinned to version `0.3.5`; the package uses MIT, and the bundled RNNoise model uses the BSD-3-Clause license.

Noise suppression is controlled by the "Settings → Voice" toggle and is enabled by default. When it is turned off, the client stops the RNNoise processor and disables Chromium's built-in suppression (`noiseSuppression: false`); when it is turned back on, it restores RNNoise with the WebRTC fallback. The echo cancellation and automatic gain control toggles are applied to the current microphone track immediately, without reconnecting to the channel. The microphone test in settings passes audio through the same processor (RNNoise when noise suppression is enabled) with the gate forced open, so the toggles are heard in the test exactly as in a call.

## Automatic sensitivity

The speech indicator does not use a single fixed threshold for all microphones. A local analyzer samples RMS every 20 ms and maintains a noise-floor estimate:

- in silence the threshold lowers quickly, so a quiet voice triggers without noticeable latency;
- with a steady background the threshold raises slowly, so a fan or room noise does not light up the frame;
- the open and close thresholds differ, and closing requires four consecutive quiet samples, so a borderline level does not cause flicker;
- during recognized speech the noise floor is frozen, so a long phrase does not raise its own threshold and cut off in the middle.

Calibration is local, does not store microphone samples, and restarts for a new audio track or input device. The same threshold controls the voice gate: a signal below the activation threshold is not published to the channel, so in silence other participants do not hear background noise. LiveKit's built-in VAD remains a backup source of speaker state.

Automatic sensitivity can be disabled in the voice settings. In manual mode a saved threshold from −80 to −10 dBFS is used: smaller values react to a quieter signal, larger values cut off the background more strongly. The manual threshold is applied immediately to the current local audio track (both to the transmit gate and to the activity indicator), does not change the microphone gain, and does not retrain from ambient noise. The close threshold is 72% of the open threshold, so a signal near the chosen boundary does not flicker between states. In Push-to-Talk mode the gate is forced open while the key is held.

In manual mode a live microphone level indicator is shown next to the threshold: the yellow area shows the position of the activation threshold, and the green area fills up to the current signal level while the microphone is being listened to. The level is measured by the local analyzer and is not sent anywhere. Changing input and output devices, noise suppression, and sensitivity while listening is applied to the active test without resetting it; when the microphone is changed, the test silently recaptures audio from the new device.

---

# Обработка голоса (Русский)

При включённом шумоподавлении OpenCord обрабатывает локальный микрофон моделью RNNoise до публикации трека в LiveKit. Модель и WebAssembly-код входят в клиент: звук не отправляется во внешний сервис и не покидает обычный медиатракт голосовой комнаты.

## Медиатракт

1. LiveKit захватывает монофонический сигнал 48 кГц с подавлением эха и выбранной пользователем автоматической регулировкой усиления.
2. `AudioWorklet` выполняет RNNoise-фильтрацию вне основного потока renderer.
3. К обработанному сигналу подмешивается 8% исходного, чтобы не обрезать тихие согласные и окончания слов.
4. Голосовой гейт плавно (12 мс на открытие, 40 мс на закрытие) приглушает сигнал ниже порога активации, чтобы фоновый шум не уходил в канал.
5. `MediaStreamAudioDestinationNode` возвращает обработанный трек в LiveKit для публикации.

Обработка выполняется локально и вне основного потока renderer. Модель загружается только при создании микрофонного трека. Если AudioWorklet или WebAssembly не запускается, клиент сохраняет голосовую сессию и использует стандартное WebRTC-шумоподавление Chromium; гейт при этом продолжает работать, если доступен Web Audio.

RNNoise не является полной копией коммерческого Krisp: это локальный фильтр речи без облачной зависимости. Выбор `@sapphi-red/web-noise-suppressor` зафиксирован версией `0.3.5`; пакет использует MIT, а встроенная модель RNNoise — лицензию BSD-3-Clause.

Шумоподавление управляется переключателем «Настройки → Голос» и включено по умолчанию. При выключении клиент останавливает RNNoise-процессор и отключает штатное подавление Chromium (`noiseSuppression: false`); при повторном включении возвращает RNNoise с фолбэком на WebRTC. Переключатели подавления эха и автоматической регулировки усиления применяются к текущему микрофонному треку сразу, без переподключения к каналу. Тест микрофона в настройках пропускает звук через тот же процессор (RNNoise при включённом шумоподавлении) с принудительно открытым гейтом, поэтому переключатели слышны в тесте так же, как в звонке.

## Автоматическая чувствительность

Индикатор речи не использует один фиксированный порог для всех микрофонов. Локальный анализатор снимает RMS каждые 20 мс и поддерживает оценку шумового пола:

- в тишине порог понижается быстро, чтобы тихий голос срабатывал без заметной задержки;
- при устойчивом фоне порог повышается медленно, чтобы вентилятор или шум комнаты не зажигал рамку;
- пороги открытия и закрытия различаются, а закрытие требует четырёх тихих измерений подряд, поэтому пограничный уровень не вызывает мерцание;
- на время распознанной речи шумовой пол замораживается, чтобы длинная фраза не повышала собственный порог и не обрывалась посередине.

Калибровка локальна, не сохраняет образцы микрофона и запускается заново для нового аудиотрека или устройства ввода. Тот же порог управляет голосовым гейтом: сигнал ниже порога активации не публикуется в канал, поэтому в тишине собеседники не слышат фоновый шум. Штатный VAD LiveKit остаётся резервным источником состояния говорящих.

Автоматическую чувствительность можно отключить в настройках голоса. В ручном режиме используется сохранённый порог от −80 до −10 дБFS: меньшие значения реагируют на более тихий сигнал, большие сильнее отсекают фон. Ручной порог применяется сразу к текущему локальному аудиотреку (и к гейту передачи, и к индикатору активности), не изменяет усиление микрофона и не переобучается от окружающего шума. Порог закрытия составляет 72% от порога открытия, поэтому сигнал возле выбранной границы не мигает между состояниями. В режиме Push-to-Talk гейт принудительно открыт, пока удерживается клавиша.

В ручном режиме рядом с порогом отображается живой индикатор уровня микрофона: жёлтая область показывает положение порога активации, а зелёная заполняется до текущего уровня сигнала во время прослушивания микрофона. Уровень измеряется локальным анализатором и никуда не передаётся. Смена устройств ввода и вывода, шумоподавления и чувствительности во время прослушивания применяется к активному тесту без его сброса; при смене микрофона тест незаметно перезахватывает звук с нового устройства.

---

# 语音处理 (中文)

启用降噪后，OpenCord 会在将音轨发布到 LiveKit 之前，用 RNNoise 模型处理本地麦克风。模型和 WebAssembly 代码随客户端一起提供：音频不会发送到外部服务，也不会离开语音房间的常规媒体链路。

## 媒体链路

1. LiveKit 采集一路带回声消除和用户所选自动增益控制的 48 kHz 单声道信号。
2. `AudioWorklet` 在 renderer 主线程之外执行 RNNoise 滤波。
3. 处理后的信号中混回 8% 的原始信号，以免截断轻辅音和词尾。
4. 语音门控会平滑地（打开 12 ms，关闭 40 ms）衰减低于激活阈值的信号，以免背景噪声进入频道。
5. `MediaStreamAudioDestinationNode` 将处理后的音轨返回给 LiveKit 进行发布。

处理在本地进行，且在 renderer 主线程之外。模型仅在创建麦克风音轨时加载。如果 AudioWorklet 或 WebAssembly 无法启动，客户端会保留语音会话，并使用 Chromium 的标准 WebRTC 降噪；此时如果 Web Audio 可用，门控会继续工作。

RNNoise 并不是商业产品 Krisp 的完整复制：它是一款没有云端依赖的本地语音滤波器。`@sapphi-red/web-noise-suppressor` 的选择被固定为 `0.3.5` 版本；该包使用 MIT 许可，而内置的 RNNoise 模型使用 BSD-3-Clause 许可。

降噪由“设置 → 语音”开关控制，默认启用。关闭后，客户端会停止 RNNoise 处理器并禁用 Chromium 的内置抑制（`noiseSuppression: false`）；重新打开后，会恢复 RNNoise 并回退到 WebRTC。回声消除和自动增益控制开关会立即应用到当前麦克风音轨，无需重新连接频道。设置中的麦克风测试会让音频经过同一处理器（启用降噪时为 RNNoise），并强制打开门控，因此开关在测试中的效果与通话中完全一致。

## 自动灵敏度

语音指示器并不会对所有麦克风使用同一个固定阈值。本地分析器每 20 ms 采样一次 RMS，并维护噪声底估计：

- 在安静时，阈值会快速降低，让轻声语音能在无明显延迟的情况下触发；
- 在背景稳定时，阈值会缓慢升高，让风扇或房间噪声不会点亮边框；
- 打开阈值和关闭阈值不同，关闭需要连续四次安静采样，因此临界电平不会引起闪烁；
- 在识别出语音期间，噪声底会被冻结，让长句不会抬高自身阈值并在中途被截断。

校准在本地进行，不保存麦克风样本，并会在新的音频轨道或输入设备上重新开始。同一阈值也控制语音门控：低于激活阈值的信号不会发布到频道，因此在安静时，其他参与者听不到背景噪声。LiveKit 的内置 VAD 仍然是说话者状态的备用来源。

自动灵敏度可以在语音设置中关闭。在手动模式下，使用 −80 到 −10 dBFS 的已保存阈值：数值越小，对越轻的信号越敏感；数值越大，越能截断背景。手动阈值会立即应用到当前的本地音频轨道（既作用于发送门控，也作用于活动指示器），不会改变麦克风增益，也不会根据环境噪声重新训练。关闭阈值为打开阈值的 72%，因此接近所选边界的信号不会在两种状态之间闪烁。在 Push-to-Talk 模式下，按住按键时门控会被强制打开。

在手动模式下，阈值旁边会显示一个实时的麦克风电平指示器：黄色区域显示激活阈值的位置，绿色区域在监听麦克风时填充到当前信号电平。该电平由本地分析器测量，不会被发送到任何地方。在监听期间切换输入和输出设备、降噪和灵敏度会应用到正在进行的测试而不会重置它；切换麦克风时，测试会静默地从新设备重新采集音频。
