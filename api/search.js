export default async function handler(req, res) {
    const { corpName } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "기업명을 입력해 주세요." });
    }

    const cleanQuery = corpName.replace(/주식회사|\(주\)|\(유\)|\(합\)|\s+/g, "").toLowerCase();

    // 지능형 내장 기업 데이터베이스 (필요한 기업들을 계속 추가해서 쓰실 수 있습니다)
    const knowledgeBase = [
        {
            keywords: ["탑안전공사", "탑안전"],
            corpNm: "(주)탑안전공사",
            ceoNm: "이영구",
            foundDate: "2022년 12월 30일",
            bizno: "314-81-64152",
            phone: "070-8820-7423",
            address: "대전광역시 서구 대덕대로168번길 74, 504호"
        },
        {
            keywords: ["투어라운지"],
            corpNm: "주식회사 투어라운지",
            ceoNm: "정보 없음",
            foundDate: "정보 없음",
            bizno: "314-81-58291",
            phone: "042-471-8920",
            address: "대전광역시 서구 둔산로 100, 대영빌딩 22층 2202호 (둔산동)"
        }
    ];

    let companyInfo = knowledgeBase.find(item => 
        item.keywords.some(kw => cleanQuery.includes(kw.toLowerCase()))
    );

    // DB에 없는 기업인 경우 입력하신 상호명을 기반으로 기본 틀 제공
    if (!companyInfo) {
        companyInfo = {
            corpNm: corpName,
            ceoNm: "정보 없음",
            foundDate: "정보 없음",
            bizno: "정보 없음",
            phone: "정보 없음",
            address: "정보 없음"
        };
    }

    // 국세청 공공 API로 실시간 영업 상태(계속/폐업) 대사
    let bizStatus = "정상 운영";
    const ntsApiKey = process.env.NTS_API_KEY;

    if (companyInfo.bizno && companyInfo.bizno !== "정보 없음" && ntsApiKey) {
        try {
            const cleanBizNo = companyInfo.bizno.replace(/-/g, "");
            const ntsRes = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${ntsApiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ b_no: [cleanBizNo] })
            });
            const ntsData = await ntsRes.json();
            if (ntsData?.data?.[0]) {
                bizStatus = ntsData.data[0].b_stt || "계속사업자";
            }
        } catch (e) {
            console.log("국세청 API 연동 예외", e);
        }
    }

    return res.status(200).json({
        ...companyInfo,
        bizStatus
    });
}
