/**
 * 📱 手机插件适配模块
 *
 * 功能：让记忆插件能够识别和正确显示手机插件的消息。
 * 来源：gaigai315/ST-Memory-Context phone-adapter.js v1.4.0。
 */
(function () {
    'use strict';

    const getTopWindow = () => {
        try {
            return window.top || window;
        } catch (e) {
            return window;
        }
    };

    function markPhoneMessages(chat) {
        if (!Array.isArray(chat)) return 0;

        let markedCount = 0;
        chat.forEach(msg => {
            if (!msg || !msg.gaigaiPhoneSignal) return;

            msg.isPhoneMessage = true;
            const hasOtherMark = msg.isGaigaiVector || msg.isGaigaiData || msg.isGaigaiPrompt;
            if (!hasOtherMark) {
                const appName = msg.gaigaiPhoneSignal.appName || '手机';
                msg.name = `SYSTEM (${appName})`;
            }
            markedCount++;
        });

        return markedCount;
    }

    function hookProbeUpdate() {
        const topWin = getTopWindow();
        const checkGaigai = setInterval(() => {
            if (!topWin.Gaigai) return;
            clearInterval(checkGaigai);

            let lastRequestData = topWin.Gaigai.lastRequestData;
            Object.defineProperty(topWin.Gaigai, 'lastRequestData', {
                get() {
                    return lastRequestData;
                },
                set(value) {
                    if (value?.chat) {
                        const count = markPhoneMessages(value.chat);
                        if (count > 0) {
                            console.log(`📱 [手机适配] 共标记 ${count} 条包含手机内容的消息`);
                        }
                    }
                    lastRequestData = value;
                },
                configurable: true,
                enumerable: true
            });

            topWin.Gaigai.markPhoneMessages = markPhoneMessages;
            console.log('✅ [手机适配] 探针钩子已安装 (v1.4.0)');
        }, 100);

        setTimeout(() => clearInterval(checkGaigai), 10000);
    }

    hookProbeUpdate();
    console.log('📱 [手机适配] 模块已加载 v1.4.0');
})();
