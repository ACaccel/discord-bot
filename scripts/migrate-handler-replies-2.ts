/**
 * Second-pass one-shot replacer for the PR 6-3 long-tail sweep.
 *
 * Unlike the first pass (which keyed by literal-only substitution
 * across all files), this pass scopes substitutions per file because
 * the long-tail strings are unique to their handler. Template
 * literals (containing `${...}`) need parameter placeholders and are
 * migrated by hand outside this script.
 *
 * Shape: `content: '<literal>'` or `content: "<literal>"` →
 * `content: bot.translator?.t('<key>') ?? ''`.
 *
 * Deleted alongside the other one-shot migration scripts when
 * Phase 6 closes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

type Sub = { file: string; literal: string; key: string };

const SUBS: readonly Sub[] = [
  // add_reply
  {
    file: 'src/handlers/commands/add_reply/index.ts',
    literal: '無法新增訊息回覆配對',
    key: 'replies:add_reply.failed',
  },
  // ai_whitelist_list
  {
    file: 'src/handlers/commands/ai_whitelist_list/index.ts',
    literal: '白名單目前為空。',
    key: 'replies:ai_whitelist.empty',
  },
  // ban_user
  {
    file: 'src/handlers/commands/ban_user/index.ts',
    literal: '無法取得投票數',
    key: 'replies:ban_user.cannot_get_votes',
  },
  {
    file: 'src/handlers/commands/ban_user/index.ts',
    literal: '還想ban機器人阿',
    key: 'replies:ban_user.cannot_ban_bot',
  },
  {
    file: 'src/handlers/commands/ban_user/index.ts',
    literal: '雖然初華大人無法禁言他，但將予以無限刪除之審判，即刻裁決！',
    key: 'replies:ban_user.cannot_timeout',
  },
  {
    file: 'src/handlers/commands/ban_user/index.ts',
    literal: '無法禁言使用者',
    key: 'replies:ban_user.failed',
  },
  // bubble_wrap
  {
    file: 'src/handlers/commands/bubble_wrap/index.ts',
    literal: '字串太長了，請縮短到 64 字元以內',
    key: 'replies:bubble_wrap.too_long',
  },
  // bug_report
  {
    file: 'src/handlers/commands/bug_report/index.ts',
    literal: '請輸入內容',
    key: 'replies:bug_report.empty_content',
  },
  {
    file: 'src/handlers/commands/bug_report/index.ts',
    literal: '無法回報問題',
    key: 'replies:bug_report.failed',
  },
  // change_avatar
  {
    file: 'src/handlers/commands/change_avatar/index.ts',
    literal: '沒有身份組設定',
    key: 'replies:change_avatar.no_role_config',
  },
  {
    file: 'src/handlers/commands/change_avatar/index.ts',
    literal: '找不到新身份',
    key: 'replies:change_avatar.new_role_not_found',
  },
  {
    file: 'src/handlers/commands/change_avatar/index.ts',
    literal: '更改失敗',
    key: 'replies:change_avatar.failed',
  },
  // change_nickname
  {
    file: 'src/handlers/commands/change_nickname/index.ts',
    literal: '更改失敗',
    key: 'replies:change_nickname.failed',
  },
  // db_list_message
  {
    file: 'src/handlers/commands/db_list_message/index.ts',
    literal: '此 channel 不是文字頻道/討論串，無法查詢',
    key: 'replies:db_list_message.not_text_channel',
  },
  {
    file: 'src/handlers/commands/db_list_message/index.ts',
    literal: '參數格式錯誤：date 請用 YYYY-MM-DD，hour（若有填）請用 0-23',
    key: 'replies:db_list_message.invalid_args',
  },
  {
    file: 'src/handlers/commands/db_list_message/index.ts',
    literal: '無法列出訊息紀錄',
    key: 'replies:db_list_message.failed',
  },
  // delete_reply
  {
    file: 'src/handlers/commands/delete_reply/index.ts',
    literal: '無法刪除訊息回覆配對',
    key: 'replies:delete_reply.failed',
  },
  // emoji_frequency
  {
    file: 'src/handlers/commands/emoji_frequency/index.ts',
    literal: '處理完成！',
    key: 'replies:emoji_frequency.done',
  },
  {
    file: 'src/handlers/commands/emoji_frequency/index.ts',
    literal: '無法取得表情符號使用頻率',
    key: 'replies:emoji_frequency.failed',
  },
  // get_avatar
  {
    file: 'src/handlers/commands/get_avatar/index.ts',
    literal: '無法取得頭像',
    key: 'replies:get_avatar.failed',
  },
  // help
  {
    file: 'src/handlers/commands/help/index.ts',
    literal: '沒有指令清單',
    key: 'replies:help.no_commands',
  },
  {
    file: 'src/handlers/commands/help/index.ts',
    literal: '無法取得指令清單',
    key: 'replies:help.failed',
  },
  // inspect_member_ids
  {
    file: 'src/handlers/commands/inspect_member_ids/index.ts',
    literal: '找不到有效 ID，請輸入 17~20 位數字的 Discord ID',
    key: 'replies:inspect_member_ids.no_valid_id',
  },
  {
    file: 'src/handlers/commands/inspect_member_ids/index.ts',
    literal: '無法建立檢查結果',
    key: 'replies:inspect_member_ids.embed_failed',
  },
  {
    file: 'src/handlers/commands/inspect_member_ids/index.ts',
    literal: '檢查可疑 ID 失敗',
    key: 'replies:inspect_member_ids.failed',
  },
  // level_detail
  {
    file: 'src/handlers/commands/level_detail/index.ts',
    literal: '太長了...請選短一點的範圍',
    key: 'replies:level_detail.too_long',
  },
  {
    file: 'src/handlers/commands/level_detail/index.ts',
    literal: '無法取得等級詳情',
    key: 'replies:level_detail.failed',
  },
  // list_guild_members
  {
    file: 'src/handlers/commands/list_guild_members/index.ts',
    literal: '目前沒有可列出的成員',
    key: 'replies:list_guild_members.empty',
  },
  {
    file: 'src/handlers/commands/list_guild_members/index.ts',
    literal: '取得成員清單失敗',
    key: 'replies:list_guild_members.failed',
  },
  // list_reply
  {
    file: 'src/handlers/commands/list_reply/index.ts',
    literal: '無法列出訊息回覆配對',
    key: 'replies:list_reply.failed',
  },
  // menu_get_avatar
  {
    file: 'src/handlers/commands/menu_get_avatar/index.ts',
    literal: '無法取得用戶頭像',
    key: 'replies:menu_get_avatar.failed',
  },
  // menu_get_sticker
  {
    file: 'src/handlers/commands/menu_get_sticker/index.ts',
    literal: '此訊息沒有貼圖或單一 emoji',
    key: 'replies:menu_get_sticker.not_found',
  },
  {
    file: 'src/handlers/commands/menu_get_sticker/index.ts',
    literal: '無法取得貼圖或 emoji',
    key: 'replies:menu_get_sticker.failed',
  },
  // random_restaurant
  {
    file: 'src/handlers/commands/random_restaurant/index.ts',
    literal: '現在半夜 餐廳都關門了啦🈹',
    key: 'replies:random_restaurant.midnight',
  },
  {
    file: 'src/handlers/commands/random_restaurant/index.ts',
    literal: '找不到符合您條件的餐廳呢',
    key: 'replies:random_restaurant.no_match',
  },
  // record
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '請先加入語音頻道',
    key: 'replies:record.join_voice_first',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '無法加入語音頻道',
    key: 'replies:record.cannot_join_voice',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '開始錄音',
    key: 'replies:record.started',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '目前沒有錄音',
    key: 'replies:record.no_recording',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '停止錄音',
    key: 'replies:record.stopped',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '未收到音訊，不儲存音檔',
    key: 'replies:record.no_audio',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '無效的指令',
    key: 'replies:record.invalid_action',
  },
  {
    file: 'src/handlers/commands/record/index.ts',
    literal: '無法錄音',
    key: 'replies:record.failed',
  },
  // role_message
  {
    file: 'src/handlers/commands/role_message/index.ts',
    literal: '你沒有權限發送身份組領取訊息',
    key: 'replies:role_message.no_permission',
  },
  {
    file: 'src/handlers/commands/role_message/index.ts',
    literal: '格式錯誤！regex: match(/^<@&\\d+>(\\s*<@&\\d+>)*$/)',
    key: 'replies:role_message.format_error',
  },
  {
    file: 'src/handlers/commands/role_message/index.ts',
    literal: '請至少提供一個有效的身份組ID',
    key: 'replies:role_message.no_valid_id',
  },
  {
    file: 'src/handlers/commands/role_message/index.ts',
    literal: '請選擇你要領取的身份組：',
    key: 'replies:role_message.prompt',
  },
  {
    file: 'src/handlers/commands/role_message/index.ts',
    literal: '無法發送身份組領取訊息',
    key: 'replies:role_message.failed',
  },
  // roll_call
  {
    file: 'src/handlers/commands/roll_call/index.ts',
    literal: '請提供被點名者 (users) 或活動ID (activity_id)',
    key: 'replies:roll_call.missing_target',
  },
  {
    file: 'src/handlers/commands/roll_call/index.ts',
    literal: '該活動目前沒有參與者',
    key: 'replies:roll_call.no_participants',
  },
  {
    file: 'src/handlers/commands/roll_call/index.ts',
    literal: '格式錯誤！regex: match(/^<@\\d+>(\\s*<@\\d+>)*$/)',
    key: 'replies:roll_call.format_error',
  },
  {
    file: 'src/handlers/commands/roll_call/index.ts',
    literal: '請至少提供一個有效的使用者ID',
    key: 'replies:roll_call.no_valid_id',
  },
  {
    file: 'src/handlers/commands/roll_call/index.ts',
    literal: '點名已發送！',
    key: 'replies:roll_call.sent',
  },
  {
    file: 'src/handlers/commands/roll_call/index.ts',
    literal: '無法進行點名',
    key: 'replies:roll_call.failed',
  },
  // search_anime_scene
  {
    file: 'src/handlers/commands/search_anime_scene/index.ts',
    literal: '請上傳圖片',
    key: 'replies:search_anime_scene.upload_image',
  },
  {
    file: 'src/handlers/commands/search_anime_scene/index.ts',
    literal: '無法搜尋動畫截圖',
    key: 'replies:search_anime_scene.failed',
  },
  // sticker_frequency
  {
    file: 'src/handlers/commands/sticker_frequency/index.ts',
    literal: '無法取得貼圖使用頻率',
    key: 'replies:sticker_frequency.failed',
  },
  // talk
  {
    file: 'src/handlers/commands/talk/index.ts',
    literal: '請輸入頻道和內容',
    key: 'replies:talk.missing_args',
  },
  {
    file: 'src/handlers/commands/talk/index.ts',
    literal: '無法傳送訊息',
    key: 'replies:talk.send_failed',
  },
  // talk_signed
  {
    file: 'src/handlers/commands/talk_signed/index.ts',
    literal: '請輸入內容',
    key: 'replies:talk_signed.missing_args',
  },
  {
    file: 'src/handlers/commands/talk_signed/index.ts',
    literal: '無法取得成員資訊',
    key: 'replies:talk_signed.member_not_found',
  },
  {
    file: 'src/handlers/commands/talk_signed/index.ts',
    literal: '無法傳送訊息',
    key: 'replies:talk_signed.send_failed',
  },
  // todo_list
  {
    file: 'src/handlers/commands/todo_list/index.ts',
    literal: '請輸入待辦事項內容',
    key: 'replies:todo_list.missing_content',
  },
  {
    file: 'src/handlers/commands/todo_list/index.ts',
    literal: '請輸入數字',
    key: 'replies:todo_list.expect_number',
  },
  {
    file: 'src/handlers/commands/todo_list/index.ts',
    literal: '無法變更待辦事項',
    key: 'replies:todo_list.failed',
  },
  // update_role
  {
    file: 'src/handlers/commands/update_role/index.ts',
    literal: '設定檔中未找到等級身分組配置',
    key: 'replies:update_role.no_config',
  },
  {
    file: 'src/handlers/commands/update_role/index.ts',
    literal: '更新完成',
    key: 'replies:update_role.done',
  },
  {
    file: 'src/handlers/commands/update_role/index.ts',
    literal: '無法更新身份組',
    key: 'replies:update_role.failed',
  },
  // weather_forecast
  {
    file: 'src/handlers/commands/weather_forecast/index.ts',
    literal: '無法取得天氣預報',
    key: 'replies:weather_forecast.failed',
  },
  // ai_settings modal
  {
    file: 'src/handlers/modals/ai_settings/index.ts',
    literal: 'Modal 識別錯誤，請重新執行 /ai_settings。',
    key: 'replies:ai_settings.modal_id_error',
  },
  {
    file: 'src/handlers/modals/ai_settings/index.ts',
    literal: '此互動只能在伺服器中使用。',
    key: 'errors:command.guild_only',
  },
  {
    file: 'src/handlers/modals/ai_settings/index.ts',
    literal: '請選擇 Model 與 Web Search 兩個欄位。',
    key: 'replies:ai_settings.missing_model_or_web_search',
  },
  {
    file: 'src/handlers/modals/ai_settings/index.ts',
    literal: 'Temperature 必須為 0.0 – 2.0 的數字。',
    key: 'replies:ai_settings.invalid_temperature',
  },
  // string_select_menu delete_reply
  {
    file: 'src/handlers/string_select_menu/delete_reply/index.ts',
    literal: '找不到該回覆紀錄',
    key: 'replies:delete_reply.record_not_found',
  },
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let totalSubs = 0;
const touchedFiles = new Set<string>();
const grouped = new Map<string, Sub[]>();
for (const s of SUBS) {
  const arr = grouped.get(s.file);
  if (arr === undefined) grouped.set(s.file, [s]);
  else arr.push(s);
}

for (const [file, subs] of grouped) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.warn(`  missing: ${file}`);
    continue;
  }
  let source = fs.readFileSync(full, 'utf8');
  let fileSubs = 0;
  for (const { literal, key } of subs) {
    const escaped = escapeRegex(literal);
    const pattern = new RegExp(`content:\\s*(['"])${escaped}\\1`, 'g');
    source = source.replace(pattern, () => {
      fileSubs += 1;
      return `content: bot.translator?.t('${key}') ?? ''`;
    });
  }
  if (fileSubs > 0) {
    fs.writeFileSync(full, source);
    touchedFiles.add(file);
    totalSubs += fileSubs;
    console.log(`  migrated ${file}: +${fileSubs}`);
  }
}
console.log(`\nMigrated ${totalSubs} replies across ${touchedFiles.size} files.`);
