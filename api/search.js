export default async function handler(req, res) {
    const { corpName } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "API 키가 설정되지 않았습니다." });
    }

    try {
        const cleanName = corpName.trim();
        const baseUrl = "https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2";
        
        const url = `${baseUrl}?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=5&corpNm=${encodeURIComponent(cleanName)}`;
        
        const response = await fetch(url);
        const text = await response.text();

        // 1. 공공데이터 서버가 JSON이 아닌 XML(에러 메시지)을 보낸 경우 그대로 화면에 노출
        if (!text.trim().startsWith("{")) {
            return res.status(200).json({
                success: false,
                corpName: "⚠️ 공공데이터 서버 에러 발생",
                ceoNm: "상세 내용 확인",
                bizno: "오류",
                crno: "오류",
                phone: "정보없음",
                address: text.substring(0, 120), // 서버가 보낸 에러 원문 일부
                status: "XML 에러 응답"
            });
        }

        const data = JSON.parse(text);
        
        // 2. API 결과 헤더에 에러 코드가 담겨 있는 경우
        const header = data?.response?.header;
        if (header && header.resultCode !== "00") {
            return res.status(200).json({
                success: false,
                corpName: `에러 코드: ${header.resultCode}`,
                ceoNm: header.resultMsg || "사유 불명",
                bizno: "확인필요",
                crno: "정보없음",
                phone: "정보없음",
                address: "공공데이터포털 승인 상태나 인증키를 다시 확인해주세요.",
                status: "API 거부됨"
            });
        }

        const items = data?.response?.body?.items?.item;
        let itemList = [];
        if (Array.isArray(items)) {
            itemList = items;
        } else if (items) {
            itemList = [items];
        }

        if (itemList.length === 0) {
            return res.status(200).json({
                success: false,
                corpName: cleanName,
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "정상 통신되었으나, 해당 검색어로 등록된 데이터가 없습니다.",
                status: "결과없음"
            });
        }

        const target = itemList[0];
        return res.status(200).json({
            success: true,
            corpName: target.corpNm || cleanName,
            ceoNm: target.ceoNm || "정보없음",
            bizno: target.bizNo || "정보없음",
            crno: target.crno || "정보없음",
            phone: target.enpTlno || "정보없음",
            address: target.enpBsadr || "정보없음",
            status: "계속사업자"
        });

    } catch (error) {
        return res.status(500).json({ error: "서버 통신 실패: " + error.message });
    }
}
