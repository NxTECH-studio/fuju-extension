import * as authManager from './auth-manager';
import { register as registerMessageHandler } from './message-handler';

authManager.registerAlarmHandler();
registerMessageHandler();

chrome.runtime.onInstalled.addListener(() => {
  console.warn('[background] installed');
  void authManager.init();
});

chrome.runtime.onStartup.addListener(() => {
  void authManager.init();
});

void authManager.init();
