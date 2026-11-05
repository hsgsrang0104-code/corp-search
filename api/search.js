// api/search.js (Vercel Serverless Function)
export default async function handler(req, res) {
    const { corpName } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "기업명을 입력해 주세요." });
    }

    try {
        // 1. 외부 AI 웹 검색 API 호출 (포털 및 웹 전체 수집)
        // ※ Perplexity, OpenAI Search, Google Gemini API 키 필요
        const aiSearchResponse = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "sonar-pro",
                messages: [{
                    role: "user",
                    content: `'${corpName}' 기업의 대표자명, 설립일, 사업자등록번호, 대표전화번호, 주소를 웹에서 검색해서 JSON 포맷으로 알려줘. 없는 항목은 "정보 없음"으로 작성해.`
                }],
                response_format: { type: "json_object" }
            })
        });

        const aiDataRaw = await aiSearchResponse.json();
        const companyInfo = JSON.parse(aiDataRaw.choices[0].message.content);

        // 2. 국세청 공공 API 실시간 교차 대사
        let bizStatus = "AI 검색 완료";
        if (companyInfo.bizno && companyInfo.bizno !== "정보 없음") {
            const cleanBizNo = companyInfo.bizno.replace(/-/g, "");
            const ntsRes = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${process.env.NTS_API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ b_no: [cleanBizNo] })
            });
            const ntsData = await ntsRes.json();
            if (ntsData?.data?.[0]) {
                bizStatus = ntsData.data[0].b_stt || "계속사업자";
            }
        }

        // 3. 최종 데이터 반환
        return res.status(200).json({
            ...companyInfo,
            bizStatus
        });

    } catch (error) {
        return res.status(500).json({ error: "실시간 AI 검색 도중 오류가 발생했습니다." });
    }
}
