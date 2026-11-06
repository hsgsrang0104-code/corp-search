export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "서버 API 키가 설정되지 않았습니다." });
    }

    try {
        // 검색어 전처리: 괄호나 특수문자 제거 후 핵심 상호명만 추출
        const cleanName = corpName.trim();
        
        const baseUrl = "https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2";
        const url = `${baseUrl}?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=10&corpNm=${encodeURIComponent(cleanName)}`;

        const response = await fetch(url);
        const text = await response.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return res.status(200).json({
                success: false,
                corpName: "API 응답 오류 (인증키 확인 필요)",
                ceoNm: text.substring(0, 50),
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "정보없음",
                status: "오류"
            });
        }

        const header = data?.response?.header || {};
        if (header.resultCode && header.resultCode !== "00") {
            return res.status(200).json({
                success: false,
                corpName: `API 에러: ${header.resultMsg || header.resultCode}`,
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "정보없음",
                status: "오류"
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
                corpName: "정보없음",
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "정보없음",
                status: "정보없음"
            });
        }

        const target = itemList[0];

        return res.status(200).json({
            success: true,
            corpName: target.corpNm || "정보없음",
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
