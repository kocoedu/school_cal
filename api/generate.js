export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 대시보드(Settings > Environment Variables)에서 GEMINI_API_KEY를 설정해주세요.' 
    });
  }

  try {
    const { image, mimeType, prompt } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: '분석할 음식 이미지(Base64)가 제공되지 않았습니다.' });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    const defaultPrompt = `이 사진은 급식 또는 식사 이미지입니다. 다음 지침에 따라 영양 분석을 수행해주세요:
1. 사진 속에 포함된 모든 음식 항목(예: 쌀밥, 제육볶음, 된장찌개, 배추김치, 계란말이 등)을 개별 식별하세요.
2. 각 음식 항목의 추정 분량, 칼로리(kcal), 탄수화물(g), 단백질(g), 지방(g)을 추정하세요.
3. 총 칼로리, 탄단지 및 나트륨, 식이섬유, 당류의 합을 산출하세요.
4. 식단의 영양 균형 점수(0~100점) 및 건강 개선 조언, 주의사항(예: 나트륨 높음 등)을 제시하세요.
5. 반드시 지정된 JSON 구조에 맞추어 한국어로 답변해주세요.`;

    const cleanBase64 = image.replace(/^data:image\/\w+;base64,/, '');

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt || defaultPrompt },
            {
              inline_data: {
                mime_type: mimeType || 'image/jpeg',
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            mealName: { type: "STRING", description: "식단의 대표 이름 (예: 한식 표준 급식)" },
            totalCalories: { type: "NUMBER", description: "총 칼로리 (kcal)" },
            healthScore: { type: "NUMBER", description: "영양 균형 점수 (0-100)" },
            summary: { type: "STRING", description: "전반적인 영양 평가 및 특징 요약" },
            macros: {
              type: "OBJECT",
              properties: {
                carbsGrams: { type: "NUMBER", description: "총 탄수화물 (g)" },
                proteinGrams: { type: "NUMBER", description: "총 단백질 (g)" },
                fatGrams: { type: "NUMBER", description: "총 지방 (g)" },
                sodiumMg: { type: "NUMBER", description: "총 나트륨 (mg)" },
                fiberGrams: { type: "NUMBER", description: "총 식이섬유 (g)" },
                sugarGrams: { type: "NUMBER", description: "총 당류 (g)" }
              },
              required: ["carbsGrams", "proteinGrams", "fatGrams", "sodiumMg"]
            },
            items: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING", description: "음식 이름" },
                  portion: { type: "STRING", description: "추정 제공량 (예: 1공기, 150g)" },
                  calories: { type: "NUMBER", description: "칼로리 (kcal)" },
                  carbs: { type: "NUMBER", description: "탄수화물 (g)" },
                  protein: { type: "NUMBER", description: "단백질 (g)" },
                  fat: { type: "NUMBER", description: "지방 (g)" },
                  description: { type: "STRING", description: "특징 설명" }
                },
                required: ["name", "portion", "calories", "carbs", "protein", "fat"]
              }
            },
            recommendations: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "영양 보완을 위한 실천 팁"
            },
            dietaryAlerts: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "주의할 영양 요소 (예: 나트륨 과다, 당류 주의)"
            }
          },
          required: ["mealName", "totalCalories", "healthScore", "summary", "macros", "items", "recommendations"]
        }
      }
    };

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('Gemini API Error:', errText);
      return res.status(apiResponse.status).json({
        error: `Gemini API 연동 실패 (${apiResponse.status})`,
        details: errText
      });
    }

    const data = await apiResponse.json();
    const resultJsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultJsonText) {
      return res.status(500).json({ error: 'Gemini 모델 응답에서 결과를 추출하지 못했습니다.' });
    }

    const parsedData = JSON.parse(resultJsonText);
    return res.status(200).json(parsedData);

  } catch (error) {
    console.error('Serverless Function Execution Error:', error);
    return res.status(500).json({
      error: '음식 이미지 분석 도중 서버 오류가 발생했습니다.',
      message: error.message
    });
  }
}